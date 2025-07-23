import { Request, Response } from 'express';
import Joi from 'joi';
import Bot from '../models/Bot';
import User from '../models/User';
import BotLog from '../models/BotLog';
import ApiKey from '../models/ApiKey';
import Trade from "../models/Trade";
import PaperTrade from '../models/PaperTrade';
import { runMovingAverageBacktest, BacktestParams } from '../services/strategyEngine';
import { ExchangeFactory } from '../services/exchange/ExchangeFactory';
import { startBotJob, stopBotJob } from '../services/botScheduler';
import { runRSIBacktest, RSIBacktestParams } from '../services/strategyEngine';
import { runStrategyBacktest } from '../services/strategyEngine';
import { decrypt } from '../utils/crypto';
import { AuthRequest } from "../middleware/auth";
import ManualTradeSignal from '../models/ManualTradeSignal';
import { runBot } from '../services/botRunner';
import Strategy from '../models/Strategy';

const createBotSchema = Joi.object({
    name: Joi.string().min(2).max(50).required(),
    exchange: Joi.string().required(),
    apiKeyRef: Joi.string().required(),
    strategy: Joi.object({
        type: Joi.string().required(),
        parameters: Joi.object().required(),
    }).required(),
    paperTrading: Joi.boolean().optional(),
    paperBalance: Joi.number().min(0).optional(),
    riskLimits: Joi.object({
        maxDailyLoss: Joi.number().min(0).optional(),
        maxPositionSize: Joi.number().min(0).optional(),
        stopLoss: Joi.number().min(0).optional(),
        takeProfit: Joi.number().min(0).optional(),
    }).optional(),
    marketType: Joi.string().valid('spot', 'futures').default('spot'),
    leverage: Joi.number().min(1).max(125).default(1),
    positionSide: Joi.string().valid('both', 'long', 'short').default('both'),
    useTestnet: Joi.boolean().optional(),
    testnetApiKeyRef: Joi.string().optional(),
    mode: Joi.string().valid('auto', 'manual').default('auto'),
});

const updateBotSchema = Joi.object({
    name: Joi.string().min(2).max(50).optional(),
    strategy: Joi.object({
        type: Joi.string().required(),
        parameters: Joi.object().required(),
    }).optional(),
    paperTrading: Joi.boolean().optional(),
    paperBalance: Joi.number().min(0).optional(),
    riskLimits: Joi.object({
        maxDailyLoss: Joi.number().min(0).optional(),
        maxPositionSize: Joi.number().min(0).optional(),
        stopLoss: Joi.number().min(0).optional(),
        takeProfit: Joi.number().min(0).optional(),
    }).optional(),
    marketType: Joi.string().valid('spot', 'futures').optional(),
    leverage: Joi.number().min(1).max(125).optional(),
    positionSide: Joi.string().valid('both', 'long', 'short').optional(),
    useTestnet: Joi.boolean().optional(),
    testnetApiKeyRef: Joi.string().optional(),
    mode: Joi.string().valid('auto', 'manual').optional(),
});

const updatePaperTradingConfigSchema = Joi.object({
  paperTrading: Joi.boolean().optional(),
  paperBalance: Joi.number().min(0).optional(),
  riskLimits: Joi.object({
    maxDailyLoss: Joi.number().min(0).optional(),
    maxPositionSize: Joi.number().min(0).optional(),
    stopLoss: Joi.number().min(0).optional(),
    takeProfit: Joi.number().min(0).optional(),
  }).optional(),
});

const idSchema = Joi.object({
    id: Joi.string().required()
});

const movingAverageBacktestSchema = Joi.object({
    strategy: Joi.string().valid('moving_average').required(),
    symbol: Joi.string().required(),
    shortPeriod: Joi.number().integer().min(1).required(),
    longPeriod: Joi.number().integer().min(1).required(),
    quantity: Joi.number().positive().required(),
    initialBalance: Joi.number().positive().required(),
    interval: Joi.string().required(),
    limit: Joi.number().integer().min(1).optional(),
    exchange: Joi.string().optional(),
    marketType: Joi.string().valid('spot', 'futures').default('spot'),
    leverage: Joi.number().min(1).max(125).default(1),
    positionSide: Joi.string().valid('both', 'long', 'short').default('both'),
});

const rsiBacktestSchema = Joi.object({
    strategy: Joi.string().valid('rsi').required(),
    symbol: Joi.string().required(),
    period: Joi.number().integer().min(1).required(),
    overbought: Joi.number().required(),
    oversold: Joi.number().required(),
    quantity: Joi.number().positive().required(),
    initialBalance: Joi.number().positive().required(),
    interval: Joi.string().required(),
    limit: Joi.number().integer().min(1).optional(),
    exchange: Joi.string().optional(),
    marketType: Joi.string().valid('spot', 'futures').default('spot'),
    leverage: Joi.number().min(1).max(125).default(1),
    positionSide: Joi.string().valid('both', 'long', 'short').default('both'),
});

// Joi schema for backtestBotStrategy
const backtestBotStrategySchema = Joi.object({
    strategyName: Joi.string().required(),
    candles: Joi.array().min(1).required(),
    params: Joi.object({
        marketType: Joi.string().valid('spot', 'futures').default('spot'),
        leverage: Joi.number().min(1).max(125).default(1),
        positionSide: Joi.string().valid('both', 'long', 'short').default('both'),
    }).optional(),
    initialBalance: Joi.number().optional(),
});

export const createBot = async (req: Request, res: Response) => {
    try {
        const { error } = createBotSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        // Additional backend validation for marketType/leverage
        const { marketType: reqMarketType, leverage: reqLeverage, strategy } = req.body;
        if (reqMarketType === 'futures') {
            if (!reqLeverage || reqLeverage < 1 || reqLeverage > 125) {
                return res.status(400).json({ error: 'Leverage must be between 1 and 125 for futures.' });
            }
        } else if (reqMarketType === 'spot') {
            if (reqLeverage !== 1) {
                return res.status(400).json({ error: 'Leverage must be 1 for spot trading.' });
            }
        }

        // --- STRATEGY VALIDATION ---
        if (!strategy || typeof strategy !== 'object' || !strategy.type) {
            return res.status(400).json({ error: 'Strategy is required and must have a type.' });
        }
        if (strategy.type === 'custom') {
            // Must provide a valid strategyId or name
            const strategyId = strategy.strategyId || strategy.id || strategy.name;
            if (!strategyId) {
                return res.status(400).json({ error: 'Custom strategy must reference a valid strategyId or name.' });
            }
            const userId = (req as AuthRequest).user?.id;
            const customStrategy = await Strategy.findOne({ $or: [ { _id: strategyId }, { name: strategyId } ], user: userId });
            if (!customStrategy) {
                return res.status(400).json({ error: 'Referenced custom strategy not found or not owned by user.' });
            }
            if (customStrategy.type !== 'custom' || !customStrategy.code) {
                return res.status(400).json({ error: 'Referenced strategy is not a valid custom strategy.' });
            }
        } else if (strategy.type === 'config') {
            // Must provide config with indicators and rules arrays
            if (!strategy.config || typeof strategy.config !== 'object') {
                return res.status(400).json({ error: 'Config strategy must include a config object.' });
            }
            if (!Array.isArray(strategy.config.indicators) || !Array.isArray(strategy.config.rules)) {
                return res.status(400).json({ error: 'Config strategy must include indicators and rules arrays.' });
            }
        } else {
            // Built-in strategies: check required parameters
            if (!strategy.parameters || typeof strategy.parameters !== 'object') {
                return res.status(400).json({ error: 'Strategy parameters are required.' });
            }
            if (strategy.type === 'moving_average') {
                const { symbol, shortPeriod, longPeriod, quantity } = strategy.parameters;
                if (!symbol || !shortPeriod || !longPeriod || !quantity) {
                    return res.status(400).json({ error: 'Missing required strategy parameters: symbol, shortPeriod, longPeriod, quantity' });
                }
            }
            // Add more built-in strategy validations as needed
        }
        // --- END STRATEGY VALIDATION ---

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const { name, exchange, apiKeyRef, strategy: strategyFromBody, paperTrading, paperBalance, riskLimits, marketType, leverage, positionSide, useTestnet, testnetApiKeyRef, mode } = req.body;
  
        if (strategyFromBody.type === 'moving_average') {
            const { symbol, shortPeriod, longPeriod, quantity } = strategyFromBody.parameters;
            if (!symbol || !shortPeriod || !longPeriod || !quantity) {
                return res.status(400).json({ error: 'Missing required strategy parameters: symbol, shortPeriod, longPeriod, quantity' });
            }
        }
  
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
  
        if (user.subscriptionStatus !== 'active') {
             return res.status(403).json({ error: 'You must have an active subscription to create a bot.' });
        }

        const apiKey = await ApiKey.findOne({ _id: apiKeyRef, user: userId });
        if (!apiKey) {
            return res.status(400).json({ error: 'Invalid API key reference.' });
        }

        const botCount = await Bot.countDocuments({ user: userId });
        if (user.subscriptionPlan === 'Basic' && botCount >= 2) {
            return res.status(403).json({ error: 'Basic plan allows up to 2 bots.' });
        }

        if (!user.subscriptionPlan || user.subscriptionPlan === 'Unknown' || user.subscriptionPlan === 'Free') {
            return res.status(403).json({ error: 'You must have a paid subscription to create a bot.' });
        }
        if (user.subscriptionPlan === 'Basic' && botCount >= 2) {
            return res.status(403).json({ error: 'Basic plan allows up to 2 bots.' });
        }
        if (user.subscriptionPlan === 'Premium' && botCount >= 12) {
            return res.status(403).json({ error: 'Premium plan allows up to 12 bots.' });
        }

        const bot = new Bot({
            user: userId,
            name,
            exchange,
            apiKeyRef,
            strategy: strategyFromBody,
            paperTrading: paperTrading !== undefined ? paperTrading : true, // Default to paper trading
            paperBalance: paperBalance || 10000, // Default $10,000
            riskLimits: {
                maxDailyLoss: riskLimits?.maxDailyLoss || 500,
                maxPositionSize: riskLimits?.maxPositionSize || 1000,
                stopLoss: riskLimits?.stopLoss || 5,
                takeProfit: riskLimits?.takeProfit || 10,
            },
            status: 'stopped',
            marketType: marketType,
            leverage: leverage,
            positionSide: positionSide,
            useTestnet: useTestnet || false,
            testnetApiKeyRef: testnetApiKeyRef || undefined,
            mode: mode || 'auto',
        });
        await bot.save();
        res.status(201).json(bot);
    } catch (err) {
        res.status(500).json({ error: 'Create bot failed' });
    }
};

export const getAllBots = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });
        
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const total = await Bot.countDocuments({ user: userId });
        const bots = await Bot.find({ user: userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        res.status(201).json({
            bots,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Fetch all bots failed' });
    }
};

export const updateBot = async (req: Request, res: Response) => {
    try {
        const { error } = updateBotSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        // Additional backend validation for marketType/leverage
        const { marketType: reqMarketType, leverage: reqLeverage, strategy } = req.body;
        if (reqMarketType === 'futures') {
            if (reqLeverage !== undefined && (reqLeverage < 1 || reqLeverage > 125)) {
                return res.status(400).json({ error: 'Leverage must be between 1 and 125 for futures.' });
            }
        } else if (reqMarketType === 'spot') {
            if (reqLeverage !== undefined && reqLeverage !== 1) {
                return res.status(400).json({ error: 'Leverage must be 1 for spot trading.' });
            }
        }

        // --- STRATEGY VALIDATION ---
        if (strategy) {
            if (!strategy.type) {
                return res.status(400).json({ error: 'Strategy type is required.' });
            }
            if (strategy.type === 'custom') {
                const strategyId = strategy.strategyId || strategy.id || strategy.name;
                if (!strategyId) {
                    return res.status(400).json({ error: 'Custom strategy must reference a valid strategyId or name.' });
                }
                const userId = (req as AuthRequest).user?.id;
                const customStrategy = await Strategy.findOne({ $or: [ { _id: strategyId }, { name: strategyId } ], user: userId });
                if (!customStrategy) {
                    return res.status(400).json({ error: 'Referenced custom strategy not found or not owned by user.' });
                }
                if (customStrategy.type !== 'custom' || !customStrategy.code) {
                    return res.status(400).json({ error: 'Referenced strategy is not a valid custom strategy.' });
                }
            } else if (strategy.type === 'config') {
                if (!strategy.config || typeof strategy.config !== 'object') {
                    return res.status(400).json({ error: 'Config strategy must include a config object.' });
                }
                if (!Array.isArray(strategy.config.indicators) || !Array.isArray(strategy.config.rules)) {
                    return res.status(400).json({ error: 'Config strategy must include indicators and rules arrays.' });
                }
            } else {
                if (!strategy.parameters || typeof strategy.parameters !== 'object') {
                    return res.status(400).json({ error: 'Strategy parameters are required.' });
                }
                if (strategy.type === 'moving_average') {
                    const { symbol, shortPeriod, longPeriod, quantity } = strategy.parameters;
                    if (!symbol || !shortPeriod || !longPeriod || !quantity) {
                        return res.status(400).json({ error: 'Missing required strategy parameters: symbol, shortPeriod, longPeriod, quantity' });
                    }
                }
                // Add more built-in strategy validations as needed
            }
        }
        // --- END STRATEGY VALIDATION ---

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });
        
        const botId = req.params.id;
        const { name, strategy: strategyFromBody, paperTrading, paperBalance, riskLimits, marketType, leverage, positionSide, useTestnet, testnetApiKeyRef, mode } = req.body;
        
        // Extra validation for moving_average strategy parameters
        if (strategyFromBody && strategyFromBody.type === 'moving_average') {
            const { symbol, shortPeriod, longPeriod, quantity } = strategyFromBody.parameters;
            if (!symbol || !shortPeriod || !longPeriod || !quantity) {
                return res.status(400).json({ error: 'Missing required strategy parameters: symbol, shortPeriod, longPeriod, quantity' });
            }
        }
        
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) {
            return res.status(404).json({ error: 'Bot not found' });
        }

        if (name) bot.name = name;
        if (strategyFromBody) bot.strategy = strategyFromBody;
        if (paperTrading !== undefined) bot.paperTrading = paperTrading;
        if (paperBalance !== undefined) bot.paperBalance = paperBalance;
        if (riskLimits) {
            bot.riskLimits = {
                ...bot.riskLimits,
                ...riskLimits,
            };
        }
        if (marketType !== undefined) bot.marketType = marketType;
        if (leverage !== undefined) bot.leverage = leverage;
        if (positionSide !== undefined) bot.positionSide = positionSide;
        if (useTestnet !== undefined) bot.useTestnet = useTestnet;
        if (testnetApiKeyRef !== undefined) bot.testnetApiKeyRef = testnetApiKeyRef;
        if (mode !== undefined) bot.mode = mode;
        
        await bot.save();
        res.status(201).json(bot);
    } catch (error) {
        res.status(500).json({ error: 'Update bot failed' });
    }
};

export const updatePaperTradingConfig = async (req: Request, res: Response) => {
    try {
        const { error } = updatePaperTradingConfigSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const { paperTrading, paperBalance, riskLimits } = req.body;
        
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });
    
        // Update paper trading settings
        if (paperTrading !== undefined) bot.paperTrading = paperTrading;
        if (paperBalance !== undefined) bot.paperBalance = paperBalance;
        if (riskLimits) {
            bot.riskLimits = {
                ...bot.riskLimits,
                ...riskLimits,
            };
        }
    
        await bot.save();
        res.status(201).json(bot);
    } catch (error) {
        res.status(500).json({ error: 'Update paper trading config failed' });
    }
};

export const deleteBot = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });
    
        // Stop the bot job if it's running
        if (bot.status === 'running') {
            stopBotJob(botId);
        }
        
        // Delete the bot
        await Bot.findByIdAndDelete(botId);
        
        // Delete associated logs
        await BotLog.deleteMany({ bot: botId });
        
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Delete bot failed' });
    }
};

export const toggleBot = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const actionSchema = Joi.object({
            action: Joi.string().valid('start', 'stop').required(),
        });
        const { error: actionError } = actionSchema.validate(req.body);
        if (actionError) return res.status(400).json({ error: actionError.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) {
            res.status(404).json({ error: 'Bot not found' });
            return;
        }

        const { action } = req.body;

        // Prevent redundant actions
        if (action === 'start' && bot.status === 'running') {
            return res.status(400).json({ error: 'Bot is already running.' });
        }
        if (action === 'stop' && bot.status === 'stopped') {
            return res.status(400).json({ error: 'Bot is already stopped.' });
        }
        
        try {
            if (action === 'start') {
                // Start the bot scheduler
                await startBotJob(botId);
                bot.status = 'running';
                
                // Log the start action
                await BotLog.create({
                    bot: bot._id,
                    timestamp: new Date(),
                    type: 'info',
                    message: 'Bot started successfully',
                });
            } else if (action === 'stop') {
                // Stop the bot scheduler
                stopBotJob(botId);
                bot.status = 'stopped';
                
                // Log the stop action
                await BotLog.create({
                    bot: bot._id,
                    timestamp: new Date(),
                    type: 'info',
                    message: 'Bot stopped successfully',
                });
            } else {
                return res.status(400).json({ error: 'Invalid action' });
            }
                
            await bot.save();
            res.status(201).json(bot);
        } catch (error) {
            await BotLog.create({
                bot: bot._id,
                timestamp: new Date(),
                type: 'error',
                message: `Failed to ${action} bot`,
                data: { error: (error as Error).message },
            });
            
            res.status(500).json({ error: `Failed to ${action} bot` });
        }
    } catch (error) {
        res.status(500).json({ error: 'toggle bot failed' });
    }
};

export const getBotLogs = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        // New: support type and search query params
        const { type, search } = req.query;
        const query: any = { bot: botId };
        if (type && typeof type === 'string' && type !== 'all') {
            query.type = type;
        }
        if (search && typeof search === 'string' && search.trim() !== '') {
            const regex = new RegExp(search, 'i');
            query.$or = [
                { message: regex },
                { type: regex }
            ];
        }

        const total = await BotLog.countDocuments({ bot: botId });
        const filterNumber = await BotLog.countDocuments(query);
        const logs = await BotLog.find(query)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);

        res.status(201).json({
            logs,
            total,
            page,
            filterNumber,
            totalPages: Math.ceil(filterNumber / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Fetch bot logs failed' });
    }
};

export const getBotPerformance = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        res.status(201).json(bot.performance);
    } catch (error) {
        res.status(500).json({ error: 'Fetch bot performance failed' });
    }
};

export const backtestBot = async (req: Request, res: Response) => {
    try {
        const { strategy = 'moving_average' } = req.body;
        let validationSchema;
        if (strategy === 'moving_average') {
            validationSchema = movingAverageBacktestSchema;
        } else if (strategy === 'rsi') {
            validationSchema = rsiBacktestSchema;
        } else {
            return res.status(400).json({ error: 'Unsupported strategy type. Supported: moving_average, rsi' });
        }

        const { error } = validationSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const {
            symbol,
            shortPeriod,
            longPeriod,
            quantity,
            initialBalance,
            interval,
            limit,
            exchange = 'binance',
            period,
            overbought,
            oversold,
            marketType = 'spot',
            leverage = 1,
            positionSide = 'both',
        } = req.body;

        // Create exchange service for backtesting (using public endpoints)
        const exchangeService = ExchangeFactory.createExchange(exchange, {
            apiKey: '',
            apiSecret: ''
        });

        // Fetch historical data
        const candles = await exchangeService.fetchKlines(symbol, interval, limit || 100);

        let result;
        if (strategy === 'moving_average') {
            // Run moving average backtest
            const maParams = {
                symbol,
                shortPeriod,
                longPeriod,
                quantity,
                initialBalance,
                marketType,
                leverage,
                positionSide,
            };
            result = runMovingAverageBacktest(candles, maParams);
        } else if (strategy === 'rsi') {
            // Run RSI backtest
            const rsiParams = {
                symbol,
                period,
                overbought,
                oversold,
                quantity,
                initialBalance,
                marketType,
                leverage,
                positionSide,
            };
            result = runRSIBacktest(candles, rsiParams);
        }

        // Return the params for confirmation (for now)
        res.status(201).json({ ...result, marketType, leverage, positionSide });
    } catch (error) {
        res.status(500).json({ error: 'Backtest failed' });
    }
};

export const testBotRun = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });
        
        let apiKey;
        if (bot.useTestnet && bot.testnetApiKeyRef) {
            apiKey = await ApiKey.findById(bot.testnetApiKeyRef);
        } else {
            apiKey = await ApiKey.findById(bot.apiKeyRef);
        }
        if (!apiKey) return res.status(400).json({ error: 'API key not found' });
        
        // Import and run the bot
        const { runBot } = await import('../services/botRunner');
        await runBot(bot, apiKey);
        
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Test bot run failed' });
    }
};

export const getPaperTrades = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const total = await PaperTrade.countDocuments({ bot: botId });
        const trades = await PaperTrade.find({ bot: botId })
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);

        res.status(201).json({
            trades,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    }  catch (error) {
        res.status(500).json({ error: 'Fetch paper trades failed' });
    }
};

export const getPaperTradingStats = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        // Pagination params
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 80;
        const skip = (page - 1) * limit;

        // Get total count for pagination
        const total = await PaperTrade.countDocuments({ 
            bot: botId,
            timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
        });

        // Get recent paper trades (paginated)
        const recentTrades = await PaperTrade.find({ 
            bot: botId,
            timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
        })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit);

        // Calculate statistics
        let totalPnL = 0;
        let wins = 0;
        let totalTrades = 0;
        let currentBalance = bot.paperBalance;

        for (const trade of recentTrades) {
            if (trade.side === 'sell' && trade.pnl !== undefined) {
                totalPnL += trade.pnl;
                totalTrades++;
                if (trade.pnl > 0) wins++;
            }
            // Update current balance to the latest trade
            if (trade.paperBalance !== undefined) {
                currentBalance = trade.paperBalance;
            }
        }

        const winRate = totalTrades > 0 ? wins / totalTrades : 0;
        const initialBalance = 10000; // Default paper balance
        const totalReturn = ((currentBalance - initialBalance) / initialBalance) * 100;

        const stats = {
            currentBalance,
            totalPnL,
            winRate,
            totalTrades,
            totalReturn,
            riskLimits: bot.riskLimits,
            paperTrading: bot.paperTrading,
        };

        res.status(201).json({ 
            stats, 
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Fetch paper trading stats failed' });
    }
};

export const updateBotApiKey = async (req: Request, res: Response) => {
    try {
        // Joi schema for apiKeyRef
        const updateApiKeySchema = Joi.object({
            apiKeyRef: Joi.string().required(),
        });

        // Validate request body
        const { error: apiKeyError } = updateApiKeySchema.validate(req.body);
        if (apiKeyError) {
            res.status(400).json({ error: apiKeyError.details[0].message });
            return;
        }

        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const { apiKeyRef } = req.body;
    
        // Verify the new API key exists and belongs to the user
        const apiKey = await ApiKey.findOne({ _id: apiKeyRef, user: userId });
        if (!apiKey) {
            res.status(400).json({ error: 'Invalid API key reference' });
            return;
        }
    
        // Update the bot's API key reference
        bot.apiKeyRef = apiKeyRef;
        await bot.save();
        
        res.status(201).json(bot);
    } catch (error) {
        res.status(500).json({ error: 'Update bot api key failed' });
    }
}; 

export const backtestBotStrategy = async (req: Request, res: Response) => {
    try {
        const { error } = backtestBotStrategySchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { strategyName, candles, params, initialBalance } = req.body;
        const result = runStrategyBacktest(strategyName, candles, params, initialBalance);

        return res.status(201).json(result);
    } catch (error) {
        return res.status(500).json({ error: 'Backtest failed' });
    }
} 

export const getBotStatus = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        res.status(201).json({ status: bot.status });
    }  catch (error) {
        res.status(500).json({ error: 'Fetch bot status failed' });
    }
};

export const getBotOpenPositions = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const botId = req.params.id;
        const bot = await Bot.findOne({ _id: botId, user: userId });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });


        let apiKey;
        if (bot.useTestnet && bot.testnetApiKeyRef) {
            apiKey = await ApiKey.findOne({ _id: bot.testnetApiKeyRef, user: userId });
        } else {
            apiKey = await ApiKey.findOne({ _id: bot.apiKeyRef, user: userId });
        }
        if (!apiKey) return res.status(400).json({ error: 'API key not found' });

        const credentials = {
            apiKey: decrypt(apiKey.apiKey),
            apiSecret: decrypt(apiKey.apiSecret),
            passphrase: (apiKey as any).passphrase,
        };
        const symbol = (bot.strategy?.parameters as any)?.symbol;
        const exchangeService = ExchangeFactory.createExchange(bot.exchange, credentials, bot.useTestnet);
    
        if (bot.strategy?.isFutures) {
            // Futures: return open positions for the bot's symbol
            const pos = await exchangeService.getPosition(symbol);
            res.status(201).json({ openPosition: pos });
        } else {
            // Spot: return open trades if available (or empty)
            if (typeof exchangeService.getOpenOrders === 'function') {
                const orders = await exchangeService.getOpenOrders(symbol);
                res.status(201).json({ openOrders: orders });
            } else {
                res.status(201).json({ openOrders: [] });
            }
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch open positions' });
    }
};

export const getUserTrades = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });
        
        const page = parseInt(req.query.page as string, 10) || 1;
        const limit = parseInt(req.query.limit as string, 10) || 50;
        const skip = (page - 1) * limit;

        const [trades, total] = await Promise.all([
            Trade.find({ user: userId })
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit),
            Trade.countDocuments({ user: userId })
        ]);

        res.json({
            trades,
            page,
            total,
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        res.status(500).json({ error: 'Get your infomation failed' });
    }
};

// Fetch all pending manual trade signals for the authenticated user
export const getManualTradeSignals = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const signals = await ManualTradeSignal.find({ user: userId, status: 'pending' }).populate('bot');

        res.status(200).json(signals);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch manual trade signals' });
    }
};

// Approve and execute a manual trade signal
export const approveManualTradeSignal = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });
        const signalId = req.params.id;
        const signal = await ManualTradeSignal.findOne({ _id: signalId, user: userId, status: 'pending' }).populate('bot');
        if (!signal) return res.status(404).json({ error: 'Manual trade signal not found' });
        // Mark as approved
        signal.status = 'approved';
        await signal.save();
        // Execute the trade (reuse runBot or direct logic)
        // For simplicity, call runBot with a special flag or implement direct execution here
        // (Assume bot and apiKey are available)
        const bot = signal.bot as any;
        let apiKey;
        if (bot.useTestnet && bot.testnetApiKeyRef) {
            apiKey = await ApiKey.findById(bot.testnetApiKeyRef);
        } else {
            apiKey = await ApiKey.findById(bot.apiKeyRef);
        }
        if (!apiKey) return res.status(400).json({ error: 'API key not found' });
        // Place the order directly (simplified)
        const credentials = {
            apiKey: decrypt(apiKey.apiKey),
            apiSecret: decrypt(apiKey.apiSecret),
        };
        const exchangeService = ExchangeFactory.createExchange(bot.exchange, credentials, bot.useTestnet);
        await exchangeService.placeOrder({
            symbol: signal.symbol,
            side: signal.signal,
            type: 'market',
            quantity: signal.quantity,
        });
        signal.status = 'executed';
        await signal.save();
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to approve/execute manual trade signal' });
    }
};

// Reject a manual trade signal
export const rejectManualTradeSignal = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });
        const signalId = req.params.id;
        const signal = await ManualTradeSignal.findOne({ _id: signalId, user: userId, status: 'pending' });
        if (!signal) return res.status(404).json({ error: 'Manual trade signal not found' });
        signal.status = 'rejected';
        await signal.save();
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject manual trade signal' });
    }
};
