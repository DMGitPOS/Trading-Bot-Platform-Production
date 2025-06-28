import { IBot } from '../models/Bot';
import { IApiKey } from '../models/ApiKey';
import { ExchangeFactory } from './exchange/ExchangeFactory';
import { decrypt } from '../utils/crypto';
import Trade from '../models/Trade';
import mongoose from 'mongoose';

interface StrategyState {
  lastSignal: 'buy' | 'sell' | null;
  position: number;
  lastTradePrice: number | null;
}

// In-memory state tracking for each bot (in production, persist in DB)
const botStates: Record<string, StrategyState> = {};

/**
 * Runs the bot's strategy using live exchange data and places real trades.
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

    // Execute trades based on signals
    if (signal === 'buy' && state.position === 0) {
      await executeBuyOrder(bot, exchangeService, symbol, quantity, currentPrice);
      state.lastSignal = 'buy';
      state.position = quantity;
      state.lastTradePrice = currentPrice;
    } else if (signal === 'sell' && state.position > 0) {
      await executeSellOrder(bot, exchangeService, symbol, state.position, currentPrice);
      state.lastSignal = 'sell';
      state.position = 0;
      state.lastTradePrice = currentPrice;
    }

    // Update bot performance
    await updateBotPerformance(bot, exchangeService);

  } catch (error) {
    console.error(`Bot ${bot.name} execution error:`, error);
    
    // Update bot status to error
    bot.status = 'error';
    await bot.save();
    
    throw error;
  }
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
 * Execute a buy order
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

    console.log(`Bot ${bot.name}: BUY order executed - ${quantity} ${symbol} at ${order.price || price}`);
  } catch (error) {
    console.error(`Bot ${bot.name}: Failed to execute BUY order:`, error);
    throw error;
  }
}

/**
 * Execute a sell order
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

    console.log(`Bot ${bot.name}: SELL order executed - ${quantity} ${symbol} at ${order.price || price}`);
  } catch (error) {
    console.error(`Bot ${bot.name}: Failed to execute SELL order:`, error);
    throw error;
  }
}

/**
 * Update bot performance based on recent trades
 */
async function updateBotPerformance(bot: IBot, exchangeService: any): Promise<void> {
  try {
    // Get recent trades for this bot
    const recentTrades = await Trade.find({ 
      bot: bot._id as mongoose.Types.ObjectId,
      timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    }).sort({ timestamp: -1 });

    if (recentTrades.length === 0) {
      return;
    }

    // Calculate PnL and win rate
    let totalPnL = 0;
    let wins = 0;
    let totalTrades = 0;

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