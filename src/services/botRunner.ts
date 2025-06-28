import { IBot } from '../models/Bot';
import { IApiKey } from '../models/ApiKey';
import { ExchangeFactory } from './exchange/ExchangeFactory';
import { decrypt } from '../utils/crypto';
import { Candle } from './strategyEngine';
import Trade from '../models/Trade';
import PaperTrade from '../models/PaperTrade';
import mongoose from 'mongoose';

interface StrategyState {
  lastSignal: 'buy' | 'sell' | null;
  position: number;
  lastTradePrice: number | null;
  paperBalance: number;
  dailyPnL: number;
  lastTradeDate: string | null;
}

// In-memory state tracking for each bot (in production, persist in DB or use a distributed queue)
const botStates: Record<string, StrategyState> = {};

/**
 * Runs the bot's strategy using live exchange data and places real or paper trades.
 * @param bot Bot document
 * @param apiKey ApiKey document
 */
export async function runBot(bot: IBot, apiKey: IApiKey): Promise<void> {
  // Extract strategy parameters from the nested structure
  const strategy = bot.strategy as any;
  console.log(`Bot ${bot.name} strategy:`, JSON.stringify(strategy, null, 2));
  
  if (!strategy || !strategy.parameters) {
    throw new Error('Bot strategy structure is invalid');
  }
  
  const { symbol, shortPeriod, longPeriod, quantity } = strategy.parameters;
  const interval = strategy.parameters.interval || '1m';
  
  console.log(`Bot ${bot.name} extracted params:`, { symbol, shortPeriod, longPeriod, quantity, interval });
  
  if (!symbol || !shortPeriod || !longPeriod || !quantity) {
    throw new Error('Bot strategy parameters missing');
  }

  const botId = (bot._id as mongoose.Types.ObjectId).toString();

  // Initialize bot state if not exists
  if (!botStates[botId]) {
    botStates[botId] = {
      lastSignal: null,
      position: 0,
      lastTradePrice: null,
      paperBalance: bot.paperBalance,
      dailyPnL: 0,
      lastTradeDate: null,
    };
  }

  const state = botStates[botId];

  try {
    // Create exchange service using factory
    const credentials = {
      apiKey: decrypt(apiKey.apiKey),
      apiSecret: decrypt(apiKey.apiSecret),
    };
    
    const exchangeService = ExchangeFactory.createExchange(bot.exchange, credentials);
    
    // Fetch recent klines for analysis
    const candles = await exchangeService.fetchKlines(symbol, interval, Math.max(shortPeriod, longPeriod) + 10);
    
    // Calculate moving averages
    const shortMA = calculateSMA(candles.map(c => c.close), shortPeriod);
    const longMA = calculateSMA(candles.map(c => c.close), longPeriod);
    
    if (shortMA === null || longMA === null) {
      console.log(`Bot ${bot.name}: Insufficient data for analysis`);
      return;
    }

    const currentPrice = candles[candles.length - 1].close;
    let signal: 'buy' | 'sell' | null = null;

    // Generate trading signals
    if (shortMA > longMA && state.lastSignal !== 'buy') {
      signal = 'buy';
    } else if (shortMA < longMA && state.lastSignal !== 'sell' && state.position > 0) {
      signal = 'sell';
    }

    // Check risk limits before executing trades
    if (!checkRiskLimits(bot, state, signal, currentPrice, quantity)) {
      console.log(`Bot ${bot.name}: Risk limits exceeded, skipping trade`);
      return;
    }

    // Execute trades based on signals
    if (signal === 'buy' && state.position === 0) {
      if (bot.paperTrading) {
        await executePaperBuyOrder(bot, symbol, quantity, currentPrice, state);
      } else {
        await executeBuyOrder(bot, exchangeService, symbol, quantity, currentPrice);
      }
      state.lastSignal = 'buy';
      state.position = quantity;
      state.lastTradePrice = currentPrice;
    } else if (signal === 'sell' && state.position > 0) {
      if (bot.paperTrading) {
        await executePaperSellOrder(bot, symbol, state.position, currentPrice, state);
      } else {
        await executeSellOrder(bot, exchangeService, symbol, state.position, currentPrice);
      }
      state.lastSignal = 'sell';
      state.position = 0;
      state.lastTradePrice = currentPrice;
    }

    // Update bot performance
    await updateBotPerformance(bot, bot.paperTrading);

  } catch (error) {
    console.error(`Bot ${bot.name} execution error:`, error);
    
    // Update bot status to error
    bot.status = 'error';
    await bot.save();
    
    throw error;
  }
}

/**
 * Check risk limits before executing trades
 */
function checkRiskLimits(bot: IBot, state: StrategyState, signal: 'buy' | 'sell' | null, price: number, quantity: number): boolean {
  const today = new Date().toDateString();
  
  // Reset daily PnL if it's a new day
  if (state.lastTradeDate !== today) {
    state.dailyPnL = 0;
    state.lastTradeDate = today;
  }

  // Check max daily loss
  if (state.dailyPnL <= -bot.riskLimits.maxDailyLoss) {
    console.log(`Bot ${bot.name}: Daily loss limit exceeded (${state.dailyPnL})`);
    return false;
  }

  // Check max position size
  const positionValue = price * quantity;
  if (positionValue > bot.riskLimits.maxPositionSize) {
    console.log(`Bot ${bot.name}: Position size exceeds limit (${positionValue} > ${bot.riskLimits.maxPositionSize})`);
    return false;
  }

  // Check stop loss and take profit for existing positions
  if (signal === 'sell' && state.position > 0 && state.lastTradePrice) {
    const priceChange = ((price - state.lastTradePrice) / state.lastTradePrice) * 100;
    
    // Stop loss check
    if (priceChange <= -bot.riskLimits.stopLoss) {
      console.log(`Bot ${bot.name}: Stop loss triggered (${priceChange.toFixed(2)}%)`);
      return true; // Allow sell for stop loss
    }
    
    // Take profit check
    if (priceChange >= bot.riskLimits.takeProfit) {
      console.log(`Bot ${bot.name}: Take profit triggered (${priceChange.toFixed(2)}%)`);
      return true; // Allow sell for take profit
    }
  }

  return true;
}

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

/**
 * Execute a paper buy order
 */
async function executePaperBuyOrder(
  bot: IBot, 
  symbol: string, 
  quantity: number, 
  price: number,
  state: StrategyState
): Promise<void> {
  try {
    const tradeValue = price * quantity;
    
    // Check if we have enough paper balance
    if (state.paperBalance < tradeValue) {
      console.log(`Bot ${bot.name}: Insufficient paper balance (${state.paperBalance} < ${tradeValue})`);
      return;
    }

    // Update paper balance
    state.paperBalance -= tradeValue;

    // Record the paper trade
    await PaperTrade.create({
      user: bot.user,
      bot: bot._id as mongoose.Types.ObjectId,
      symbol,
      side: 'buy',
      quantity,
      price,
      timestamp: new Date(),
      status: 'filled',
      exchange: bot.exchange,
      paperBalance: state.paperBalance,
      tradeType: 'paper',
    });

    console.log(`Bot ${bot.name}: PAPER BUY order executed - ${quantity} ${symbol} at ${price} (Balance: ${state.paperBalance})`);
  } catch (error) {
    console.error(`Bot ${bot.name}: Failed to execute PAPER BUY order:`, error);
    throw error;
  }
}

/**
 * Execute a paper sell order
 */
async function executePaperSellOrder(
  bot: IBot, 
  symbol: string, 
  quantity: number, 
  price: number,
  state: StrategyState
): Promise<void> {
  try {
    const tradeValue = price * quantity;
    
    // Update paper balance
    state.paperBalance += tradeValue;

    // Calculate PnL for this trade
    let pnl = 0;
    if (state.lastTradePrice) {
      pnl = (price - state.lastTradePrice) * quantity;
      state.dailyPnL += pnl;
    }

    // Record the paper trade
    await PaperTrade.create({
      user: bot.user,
      bot: bot._id as mongoose.Types.ObjectId,
      symbol,
      side: 'sell',
      quantity,
      price,
      timestamp: new Date(),
      status: 'filled',
      exchange: bot.exchange,
      paperBalance: state.paperBalance,
      tradeType: 'paper',
      pnl,
    });

    console.log(`Bot ${bot.name}: PAPER SELL order executed - ${quantity} ${symbol} at ${price} (Balance: ${state.paperBalance}, PnL: ${pnl})`);
  } catch (error) {
    console.error(`Bot ${bot.name}: Failed to execute PAPER SELL order:`, error);
    throw error;
  }
}

/**
 * Execute a real buy order
 */
async function executeBuyOrder(
  bot: IBot, 
  exchangeService: any, 
  symbol: string, 
  quantity: number, 
  price: number
): Promise<void> {
  try {
    const order = await exchangeService.placeOrder({
      symbol,
      side: 'buy',
      type: 'market',
      quantity,
    });

    // Record the trade
    await Trade.create({
      user: bot.user,
      bot: bot._id as mongoose.Types.ObjectId,
      symbol,
      side: 'buy',
      quantity,
      price: order.price || price,
      orderId: order.id,
      timestamp: new Date(),
      status: order.status,
      exchange: bot.exchange,
    });

    console.log(`Bot ${bot.name}: REAL BUY order executed - ${quantity} ${symbol} at ${order.price || price}`);
  } catch (error) {
    console.error(`Bot ${bot.name}: Failed to execute REAL BUY order:`, error);
    throw error;
  }
}

/**
 * Execute a real sell order
 */
async function executeSellOrder(
  bot: IBot, 
  exchangeService: any, 
  symbol: string, 
  quantity: number, 
  price: number
): Promise<void> {
  try {
    const order = await exchangeService.placeOrder({
      symbol,
      side: 'sell',
      type: 'market',
      quantity,
    });

    // Record the trade
    await Trade.create({
      user: bot.user,
      bot: bot._id as mongoose.Types.ObjectId,
      symbol,
      side: 'sell',
      quantity,
      price: order.price || price,
      orderId: order.id,
      timestamp: new Date(),
      status: order.status,
      exchange: bot.exchange,
    });

    console.log(`Bot ${bot.name}: REAL SELL order executed - ${quantity} ${symbol} at ${order.price || price}`);
  } catch (error) {
    console.error(`Bot ${bot.name}: Failed to execute REAL SELL order:`, error);
    throw error;
  }
}

/**
 * Update bot performance based on recent trades
 */
async function updateBotPerformance(bot: IBot, isPaperTrading: boolean): Promise<void> {
  try {
    let recentTrades;
    
    if (isPaperTrading) {
      // Get recent paper trades for this bot
      recentTrades = await PaperTrade.find({ 
        bot: bot._id as mongoose.Types.ObjectId,
        timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
      }).sort({ timestamp: -1 });
    } else {
      // Get recent real trades for this bot
      recentTrades = await Trade.find({ 
        bot: bot._id as mongoose.Types.ObjectId,
        timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
      }).sort({ timestamp: -1 });
    }

    if (recentTrades.length === 0) {
      return;
    }

    // Calculate PnL and win rate
    let totalPnL = 0;
    let wins = 0;
    let totalTrades = 0;

    if (isPaperTrading) {
      // For paper trades, use the stored PnL
      for (const trade of recentTrades) {
        const paperTrade = trade as any; // Type assertion for paper trade
        if (paperTrade.side === 'sell' && paperTrade.pnl !== undefined) {
          totalPnL += paperTrade.pnl;
          totalTrades++;
          if (paperTrade.pnl > 0) wins++;
        }
      }
    } else {
      // For real trades, calculate PnL from buy/sell pairs
      for (let i = 0; i < recentTrades.length - 1; i++) {
        const buyTrade = recentTrades[i + 1];
        const sellTrade = recentTrades[i];

        if (buyTrade.side === 'buy' && sellTrade.side === 'sell') {
          const tradePnL = (sellTrade.price - buyTrade.price) * buyTrade.quantity;
          totalPnL += tradePnL;
          totalTrades++;

          if (tradePnL > 0) {
            wins++;
          }
        }
      }
    }

    const winRate = totalTrades > 0 ? wins / totalTrades : 0;

    // Update bot performance
    bot.performance = {
      pnl: totalPnL,
      winRate: winRate,
      tradeCount: totalTrades,
      lastTradeAt: recentTrades[0].timestamp,
    };

    await bot.save();
  } catch (error) {
    console.error(`Failed to update bot performance:`, error);
  }
} 