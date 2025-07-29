import { IBot } from '../models/Bot';
import { IApiKey } from '../models/ApiKey';
import { ExchangeFactory } from './exchange/ExchangeFactory';
import { decrypt } from '../utils/crypto';
import { Candle, detectVolatilityRegime, getVolatilityAdjustedParams, updateDrawdownState, DrawdownState } from './strategyEngine';
import Trade from '../models/Trade';
import PaperTrade from '../models/PaperTrade';
import mongoose from 'mongoose';
import { strategyRegistry, interpretConfigStrategy, generateEnhancedMovingAverageSignal } from './strategyEngine';
import { notifyUser } from './notification/notifyUser';
import ManualTradeSignal from '../models/ManualTradeSignal';
import Strategy from '../models/Strategy';

interface StrategyState {
    lastSignal: 'buy' | 'sell' | null;
    position: number;
    lastTradePrice: number | null;
    paperBalance: number;
    dailyPnL: number;
    lastTradeDate: string | null;
    lastFundingTime?: number; // Track last funding time for funding payments
    entryPrice?: number; // Track entry price for PnL calculation
    isLongPosition?: boolean; // Track if current position is long or short
    // Enhanced features
    drawdownState?: DrawdownState;
    volatilityRegime?: 'low' | 'normal' | 'high';
    lastVolatilityCheck?: number;
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

    // Helper function to round to 8 decimal places (standard for crypto)
    const roundTo8 = (num: number): number => Math.round(num * 100000000) / 100000000;

    // Initialize bot state if not exists
    if (!botStates[botId]) {
        botStates[botId] = {
            lastSignal: null,
            position: 0,
            lastTradePrice: null,
            paperBalance: bot.paperBalance,
            dailyPnL: 0,
            lastTradeDate: null,
            // Initialize enhanced features
            drawdownState: {
                peakBalance: bot.paperBalance,
                currentDrawdown: 0,
                maxDrawdownReached: 0,
                lastPeakTime: Date.now()
            },
            volatilityRegime: 'normal',
            lastVolatilityCheck: 0
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

        // --- ENHANCED FEATURES: DRAWDOWN CHECK ---
        if (bot.drawdownConfig?.enabled) {
            const drawdownCheck = updateDrawdownState(state.drawdownState!, state.paperBalance, bot.drawdownConfig);
            if (drawdownCheck.shouldStop) {
                console.log(`Bot ${bot.name}: Stopping due to drawdown - ${drawdownCheck.reason}`);
                await notifyUser({
                    userId: bot.user.toString(),
                    type: 'alert',
                    message: `Bot ${bot.name}: STOPPED due to drawdown - ${drawdownCheck.reason}`,
                    botName: bot.name,
                });
                return; // Stop trading
            }
        }

        // --- FUTURES SUPPORT ---
        const isFutures = bot.marketType === 'futures';
        let currentPosition = 0;
        let fundingRate = 0;
        let nextFundingTime = 0;
        if (isFutures) {
            // Set leverage if supported by the exchange service
            if (typeof exchangeService.setLeverage === 'function') {
                await exchangeService.setLeverage(symbol, bot.leverage || 1);
            }
            const pos = await exchangeService.getPosition(symbol);
            currentPosition = pos ? pos.positionAmt : 0;
            // --- FUNDING RATE LOGIC ---
            if (currentPosition !== 0 && typeof exchangeService.getFundingRate === 'function') {
                try {
                    const fundingInfo = await exchangeService.getFundingRate(symbol);
                    fundingRate = fundingInfo.fundingRate;
                    nextFundingTime = fundingInfo.nextFundingTime;
                    // Only apply funding if it's time and we haven't already for this interval
                    if (!state.lastFundingTime || Date.now() > state.lastFundingTime) {
                        // Funding payment = position size * funding rate
                        // Funding rate is per contract, so multiply by position size (signed)
                        const fundingPayment = currentPosition * fundingRate;
                        if (fundingPayment !== 0) {
                            state.dailyPnL += fundingPayment;
                            // Optionally, notify user
                            await notifyUser({
                                userId: bot.user.toString(),
                                type: 'alert',
                                message: `Bot ${bot.name}: Funding payment applied: ${fundingPayment.toFixed(8)} (${(fundingRate * 100).toFixed(4)}%) for position ${currentPosition} ${symbol}`,
                                botName: bot.name,
                                data: { fundingPayment, fundingRate, position: currentPosition, symbol },
                            });
                        }
                        // Update lastFundingTime to the next funding time
                        state.lastFundingTime = nextFundingTime;
                    }
                } catch (err) {
                    console.error(`Bot ${bot.name}: Failed to fetch/apply funding rate:`, err);
                }
            }
        } else {
            currentPosition = state.position;
        }

        // Fetch recent klines for analysis
        const candles = await exchangeService.fetchKlines(symbol, interval, Math.max(shortPeriod, longPeriod) + 10);
        const currentPrice = candles[candles.length - 1]?.close;

        // --- ENHANCED FEATURES: VOLATILITY DETECTION ---
        let adjustedStrategyParams = { shortPeriod, longPeriod, quantity };
        if (bot.volatilityConfig?.enabled && Date.now() - (state.lastVolatilityCheck || 0) > 5 * 60 * 1000) { // Check every 5 minutes
            const volatilityRegime = detectVolatilityRegime(candles, bot.volatilityConfig);
            state.volatilityRegime = volatilityRegime;
            state.lastVolatilityCheck = Date.now();
            
            adjustedStrategyParams = getVolatilityAdjustedParams(
                { shortPeriod, longPeriod, quantity },
                volatilityRegime,
                bot.volatilityConfig
            );
            
            console.log(`Bot ${bot.name}: Volatility regime detected: ${volatilityRegime}, adjusted params:`, adjustedStrategyParams);
        }

        // --- ENHANCED STRATEGY EXECUTION ---
        let strategyName: string = (typeof bot.strategy?.name === 'string' && bot.strategy?.name) ? bot.strategy.name : 'moving_average';
        let signal: 'buy' | 'sell' | null = null;
        
        if (bot.strategy?.type === 'moving_average') {
            // Use enhanced moving average with confirmation signals
            signal = generateEnhancedMovingAverageSignal(candles, state, {
                shortPeriod: adjustedStrategyParams.shortPeriod,
                longPeriod: adjustedStrategyParams.longPeriod,
                positionSide: bot.positionSide,
                marketType: bot.marketType,
                confirmationSignals: bot.confirmationSignals
            });
        } else if (bot.strategy?.type !== 'rsi') {
            // Interpret config-based strategy (visual builder)
            try {
                const strategyResult: any = await Strategy.findById(bot.strategy?.type);
                if (!strategyResult) {
                    throw new Error(`Strategy not found`);
                }
                const config = strategyResult.config && typeof strategyResult.config === 'object'
                    ? {
                        indicators: Array.isArray((strategyResult.config as any).indicators) ? (strategyResult.config as any).indicators : [],
                        rules: Array.isArray((strategyResult.config as any).rules) ? (strategyResult.config as any).rules : [],
                        risk: typeof (strategyResult.config as any).risk === 'object' ? (strategyResult.config as any).risk : {},
                    }
                    : { indicators: [], rules: [], risk: {} };
                signal = interpretConfigStrategy(candles, state, config);
                if (signal !== 'buy' && signal !== 'sell' && signal !== null) {
                    throw new Error('Config strategy must return "buy", "sell", or null');
                }
                // --- TP/SL and Auto-Reverse Logic ---
                const tpPct = config.risk?.takeProfit ? config.risk.takeProfit / 100 : 0.005;
                const slPct = config.risk?.stopLoss ? config.risk.stopLoss / 100 : 0.003;
                const autoReverse = config.risk?.autoReverse !== false; // default true
                if (state.position !== 0 && state.entryPrice) {
                    const tp = state.position > 0 ? state.entryPrice * (1 + tpPct) : state.entryPrice * (1 - tpPct);
                    const sl = state.position > 0 ? state.entryPrice * (1 - slPct) : state.entryPrice * (1 + slPct);
                    if ((state.position > 0 && (currentPrice >= tp || currentPrice <= sl)) ||
                        (state.position < 0 && (currentPrice <= tp || currentPrice >= sl))) {
                        // Close position for TP/SL
                        if (bot.paperTrading) {
                            if (state.position > 0) {
                                await executePaperSellOrder(bot, symbol, state.position, currentPrice, state);
                            } else {
                                await executePaperBuyOrder(bot, symbol, Math.abs(state.position), currentPrice, state);
                            }
                        } else {
                            if (state.position > 0) {
                                await executeSellOrder(bot, exchangeService, symbol, state.position, currentPrice);
                            } else {
                                await executeBuyOrder(bot, exchangeService, symbol, Math.abs(state.position), currentPrice);
                            }
                        }
                        state.position = 0;
                        state.entryPrice = undefined;
                        state.lastSignal = null;
                        await notifyUser({
                            userId: bot.user.toString(),
                            type: 'alert',
                            message: `Bot ${bot.name}: Position closed by TP/SL at ${currentPrice}`,
                            botName: bot.name,
                        });
                        return;
                    }
                }
                // --- Auto-Reverse Logic ---
                if (signal === 'buy' && state.position <= 0) {
                    // If short, close and reverse
                    if (state.position < 0) {
                        if (bot.paperTrading) {
                            await executePaperBuyOrder(bot, symbol, Math.abs(state.position), currentPrice, state);
                        } else {
                            await executeBuyOrder(bot, exchangeService, symbol, Math.abs(state.position), currentPrice);
                        }
                        state.position = 0;
                        state.entryPrice = undefined;
                        state.lastSignal = null;
                    }
                    if (state.position === 0 && (autoReverse || state.lastSignal !== 'buy')) {
                        if (bot.paperTrading) {
                            await executePaperBuyOrder(bot, symbol, quantity, currentPrice, state);
                        } else {
                            await executeBuyOrder(bot, exchangeService, symbol, quantity, currentPrice);
                        }
                        state.position = quantity;
                        state.entryPrice = currentPrice;
                        state.lastSignal = 'buy';
                        await notifyUser({
                            userId: bot.user.toString(),
                            type: 'alert',
                            message: `Bot ${bot.name}: BUY ${quantity} ${symbol} at ${currentPrice}`,
                            botName: bot.name,
                        });
                    }
                } else if (signal === 'sell' && state.position >= 0) {
                    // If long, close and reverse
                    if (state.position > 0) {
                        if (bot.paperTrading) {
                            await executePaperSellOrder(bot, symbol, state.position, currentPrice, state);
                        } else {
                            await executeSellOrder(bot, exchangeService, symbol, state.position, currentPrice);
                        }
                        state.position = 0;
                        state.entryPrice = undefined;
                        state.lastSignal = null;
                    }
                    if (state.position === 0 && (autoReverse || state.lastSignal !== 'sell')) {
                        if (bot.paperTrading) {
                            await executePaperSellOrder(bot, symbol, quantity, currentPrice, state);
                        } else {
                            await executeSellOrder(bot, exchangeService, symbol, quantity, currentPrice);
                        }
                        state.position = -quantity;
                        state.entryPrice = currentPrice;
                        state.lastSignal = 'sell';
                        await notifyUser({
                            userId: bot.user.toString(),
                            type: 'alert',
                            message: `Bot ${bot.name}: SELL ${quantity} ${symbol} at ${currentPrice}`,
                            botName: bot.name,
                        });
                    }
                }
                return;
            } catch (err) {
                console.error(`Bot ${bot.name}: Failed to interpret config strategy:`, err);
                await notifyUser({
                    userId: bot.user.toString(),
                    type: 'error',
                    message: `Bot ${bot.name}: Config strategy execution failed: ${err instanceof Error ? err.message : String(err)}`,
                    botName: bot.name,
                });
                signal = null;
            }
        } else {
            // Built-in strategy
            const strategyFn = strategyRegistry[strategyName];
            if (!strategyFn) {
                throw new Error(`Strategy ${strategyName} not found`);
            }
            // Pass additional parameters for position side and market type
            const enhancedParams = {
                ...adjustedStrategyParams,
                positionSide: bot.positionSide,
                marketType: bot.marketType,
            };
            signal = strategyFn(candles, state, enhancedParams);
        }
        // --- END DYNAMIC STRATEGY SELECTION ---

        // Position side filtering is now handled within the strategy functions
        let finalSignal = signal;

        // Use adjusted parameters for quantity
        const finalQuantity = adjustedStrategyParams.quantity;
        
        // Check risk limits before executing trades
        if (!await checkRiskLimits(bot, state, finalSignal, currentPrice, finalQuantity)) {
            console.log(`Bot ${bot.name}: Risk limits exceeded, skipping trade`);
            return;
        }
        // --- MANUAL MODE SUPPORT ---
        if (bot.mode === 'manual') {
            if (finalSignal === 'buy' || finalSignal === 'sell') {
                // Create a pending manual trade signal in the DB
                await ManualTradeSignal.create({
                    user: bot.user,
                    bot: bot._id,
                    signal: finalSignal,
                    symbol,
                    price: currentPrice,
                    quantity: finalQuantity,
                    marketType: bot.marketType,
                    leverage: bot.leverage,
                    positionSide: bot.positionSide,
                    status: 'pending',
                });
                // Notify user
                await notifyUser({
                    userId: bot.user.toString(),
                    type: 'manual_trade',
                    message: `Manual trade signal for ${bot.name}: ${finalSignal.toUpperCase()} ${finalQuantity} ${symbol} at ${currentPrice}`,
                    botName: bot.name,
                    data: {
                        signal: finalSignal,
                        symbol,
                        quantity: finalQuantity,
                        price: currentPrice,
                        marketType: bot.marketType,
                        leverage: bot.leverage,
                        positionSide: bot.positionSide,
                    },
                });
                // Do not execute the trade automatically
                return;
            }
        }
        // --- FUTURES ORDER EXECUTION ---
        if (isFutures) {
            if (finalSignal === 'buy' && currentPosition <= 0) {
                // Close short if exists, then open long
                if (currentPosition < 0) {
                    await exchangeService.closePosition(symbol);
                }
                await exchangeService.placeOrder({
                    symbol,
                    side: 'buy',
                    type: 'market',
                    quantity: finalQuantity,
                });
                state.lastSignal = 'buy';
                state.position = finalQuantity;
                state.lastTradePrice = currentPrice;
                // Notify user of buy trade
                await notifyUser({
                    userId: bot.user.toString(),
                    type: 'alert',
                    message: `Bot ${bot.name}: BUY ${finalQuantity} ${symbol} at ${currentPrice}`,
                    botName: bot.name,
                });
            } else if (finalSignal === 'sell' && currentPosition > 0) {
                // Close long if exists, then open short
                await exchangeService.closePosition(symbol);
                await exchangeService.placeOrder({
                    symbol,
                    side: 'sell',
                    type: 'market',
                    quantity: finalQuantity,
                });
                state.lastSignal = 'sell';
                state.position = -finalQuantity;
                state.lastTradePrice = currentPrice;
                // Notify user of sell trade
                await notifyUser({
                    userId: bot.user.toString(),
                    type: 'alert',
                    message: `Bot ${bot.name}: SELL ${finalQuantity} ${symbol} at ${currentPrice}`,
                    botName: bot.name,
                });
            }
        } else {
            // --- SPOT ORDER EXECUTION (true reversal logic) ---
            if (finalSignal === 'buy') {
                if (state.position > 0) {
                    // Already long, do nothing
                } else if (state.position === 0) {
                    // Flat, just buy
                    if (bot.paperTrading) {
                        await executePaperBuyOrder(bot, symbol, quantity, currentPrice, state);
                    } else {
                        await executeBuyOrder(bot, exchangeService, symbol, quantity, currentPrice);
                    }
                    state.lastSignal = 'buy';
                    state.position = quantity;
                    state.lastTradePrice = currentPrice;
                    await notifyUser({
                        userId: bot.user.toString(),
                        type: 'alert',
                        message: `Bot ${bot.name}: BUY ${quantity} ${symbol} at ${currentPrice}`,
                        botName: bot.name,
                    });
                } else if (state.position > 0) {
                    // Already long, do nothing
                } else if (state.position < 0) {
                    // If you support shorting spot, close short, then buy (not typical)
                }
            } else if (finalSignal === 'sell') {
                if (state.position > 0) {
                    // Currently long, sell, then immediately buy if reversal
                    if (bot.paperTrading) {
                        await executePaperSellOrder(bot, symbol, state.position, currentPrice, state);
                    } else {
                        await executeSellOrder(bot, exchangeService, symbol, state.position, currentPrice);
                    }
                    state.lastSignal = 'sell';
                    state.position = 0;
                    state.lastTradePrice = currentPrice;
                    await notifyUser({
                        userId: bot.user.toString(),
                        type: 'alert',
                        message: `Bot ${bot.name}: SELL ${state.position} ${symbol} at ${currentPrice}`,
                        botName: bot.name,
                    });
                    // Immediately buy again for reversal
                    if (bot.paperTrading) {
                        await executePaperBuyOrder(bot, symbol, quantity, currentPrice, state);
                    } else {
                        await executeBuyOrder(bot, exchangeService, symbol, quantity, currentPrice);
                    }
                    state.lastSignal = 'buy';
                    state.position = quantity;
                    state.lastTradePrice = currentPrice;
                    await notifyUser({
                        userId: bot.user.toString(),
                        type: 'alert',
                        message: `Bot ${bot.name}: BUY ${quantity} ${symbol} at ${currentPrice} (Reversal)`,
                        botName: bot.name,
                    });
                } else if (state.position === 0) {
                    // Flat, do nothing (or sell if you support shorting spot)
                }
            }
        }
        // Update bot performance
        await updateBotPerformance(bot, bot.paperTrading);
    } catch (error) {
        console.error(`Bot ${bot.name} execution error:`, error);
        // Notify user of error
        await notifyUser({
            userId: bot.user.toString(),
            type: 'error',
            message: `Bot ${bot.name} encountered an error: ${error instanceof Error ? error.message : String(error)}`,
            botName: bot.name,
        });
        // Update bot status to error
        bot.status = 'error';
        await bot.save();
        throw error;
    }
}

/**
 * Check risk limits before executing trades
 */
async function checkRiskLimits(bot: IBot, state: StrategyState, signal: 'buy' | 'sell' | null, price: number, quantity: number): Promise<boolean> {
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
            // Notify user of stop loss
            await notifyUser({
                userId: bot.user.toString(),
                type: 'alert',
                message: `Bot ${bot.name}: STOP LOSS triggered at ${price} (${priceChange.toFixed(2)}%)`,
                botName: bot.name,
            });
            return true; // Allow sell for stop loss
        }
        
        // Take profit check
        if (priceChange >= bot.riskLimits.takeProfit) {
            console.log(`Bot ${bot.name}: Take profit triggered (${priceChange.toFixed(2)}%)`);
            // Notify user of take profit
            await notifyUser({
                userId: bot.user.toString(),
                type: 'alert',
                message: `Bot ${bot.name}: TAKE PROFIT triggered at ${price} (${priceChange.toFixed(2)}%)`,
                botName: bot.name,
            });
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
        // Helper function to round to 8 decimal places
        const roundTo8 = (num: number): number => Math.round(num * 100000000) / 100000000;
        
        const tradeValue = roundTo8(price * quantity);
        
        // Check if we have enough paper balance
        if (state.paperBalance < tradeValue) {
            console.log(`Bot ${bot.name}: Insufficient paper balance (${state.paperBalance} < ${tradeValue})`);
            return;
        }

        // Calculate PnL if closing a short position
        let pnl = 0;
        if (state.position < 0 && state.entryPrice) {
            // Closing short position: profit if price went down
            pnl = roundTo8((state.entryPrice - price) * Math.abs(state.position));
            state.dailyPnL = roundTo8(state.dailyPnL + pnl);
        }

        // Update paper balance
        state.paperBalance = roundTo8(state.paperBalance - tradeValue);

        // Update position tracking
        if (state.position < 0) {
            // Closing short position
            state.position = 0;
            state.entryPrice = undefined;
            state.isLongPosition = undefined;
        } else {
            // Opening long position
            state.position = roundTo8(state.position + quantity);
            state.entryPrice = price;
            state.isLongPosition = true;
        }

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
            pnl,
        });

        console.log(`Bot ${bot.name}: PAPER BUY order executed - ${quantity} ${symbol} at ${price} (Balance: ${state.paperBalance}, PnL: ${pnl})`);
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
        // Helper function to round to 8 decimal places
        const roundTo8 = (num: number): number => Math.round(num * 100000000) / 100000000;
        
        const tradeValue = roundTo8(price * quantity);
        
        // Calculate PnL if closing a long position
        let pnl = 0;
        if (state.position > 0 && state.entryPrice) {
            // Closing long position: profit if price went up
            pnl = roundTo8((price - state.entryPrice) * state.position);
            state.dailyPnL = roundTo8(state.dailyPnL + pnl);
        }

        // Update paper balance
        state.paperBalance = roundTo8(state.paperBalance + tradeValue);

        // Update position tracking
        if (state.position > 0) {
            // Closing long position
            state.position = 0;
            state.entryPrice = undefined;
            state.isLongPosition = undefined;
        } else {
            // Opening short position
            state.position = roundTo8(state.position - quantity);
            state.entryPrice = price;
            state.isLongPosition = false;
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