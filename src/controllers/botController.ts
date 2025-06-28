import { Request, Response } from 'express';
import Bot from '../models/Bot';
import User from '../models/User';
import BotLog from '../models/BotLog';
import ApiKey from '../models/ApiKey';
import PaperTrade from '../models/PaperTrade';
import { runMovingAverageBacktest, BacktestParams } from '../services/strategyEngine';
import { ExchangeFactory } from '../services/exchange/ExchangeFactory';
import { startBotJob, stopBotJob } from '../services/botScheduler';

export const createBot = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const { name, exchange, apiKeyRef, strategy, paperTrading, paperBalance, riskLimits } = req.body;
  
  // Validate strategy structure
  if (!strategy || !strategy.type || !strategy.parameters) {
    res.status(400).json({ message: 'Invalid strategy structure. Strategy must have type and parameters.' });
    return;
  }
  
  if (strategy.type === 'moving_average') {
    const { symbol, shortPeriod, longPeriod, quantity } = strategy.parameters;
    if (!symbol || !shortPeriod || !longPeriod || !quantity) {
      res.status(400).json({ message: 'Missing required strategy parameters: symbol, shortPeriod, longPeriod, quantity' });
      return;
    }
  }
  
  const user = await User.findById(userId);
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  if (user.subscriptionStatus !== 'active') {
    res.status(403).json({ message: 'You must have an active subscription to create a bot.' });
    return;
  }
  const apiKey = await ApiKey.findOne({ _id: apiKeyRef, user: userId });
  if (!apiKey) {
    res.status(400).json({ message: 'Invalid API key reference.' });
    return;
  }
  const botCount = await Bot.countDocuments({ user: userId });
  if (user.subscriptionPlan === 'Basic' && botCount >= 2) {
    res.status(403).json({ message: 'Basic plan allows up to 2 bots.' });
    return;
  }
  const bot = new Bot({
    user: userId,
    name,
    exchange,
    apiKeyRef,
    strategy,
    paperTrading: paperTrading !== undefined ? paperTrading : true, // Default to paper trading
    paperBalance: paperBalance || 10000, // Default $10,000
    riskLimits: {
      maxDailyLoss: riskLimits?.maxDailyLoss || 500,
      maxPositionSize: riskLimits?.maxPositionSize || 1000,
      stopLoss: riskLimits?.stopLoss || 5,
      takeProfit: riskLimits?.takeProfit || 10,
    },
    status: 'stopped',
  });
  await bot.save();
  res.status(201).json({ bot });
};

export const listBots = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const bots = await Bot.find({ user: userId });
  res.json({ bots });
};

export const updateBot = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const botId = req.params.id;
  const { name, strategy, paperTrading, paperBalance, riskLimits } = req.body;
  
  // Validate strategy structure if provided
  if (strategy) {
    if (!strategy.type || !strategy.parameters) {
      res.status(400).json({ message: 'Invalid strategy structure. Strategy must have type and parameters.' });
      return;
    }
    
    if (strategy.type === 'moving_average') {
      const { symbol, shortPeriod, longPeriod, quantity } = strategy.parameters;
      if (!symbol || !shortPeriod || !longPeriod || !quantity) {
        res.status(400).json({ message: 'Missing required strategy parameters: symbol, shortPeriod, longPeriod, quantity' });
        return;
      }
    }
  }
  
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) {
    res.status(404).json({ message: 'Bot not found' });
    return;
  }
  if (name) bot.name = name;
  if (strategy) bot.strategy = strategy;
  if (paperTrading !== undefined) bot.paperTrading = paperTrading;
  if (paperBalance !== undefined) bot.paperBalance = paperBalance;
  if (riskLimits) {
    bot.riskLimits = {
      ...bot.riskLimits,
      ...riskLimits,
    };
  }
  await bot.save();
  res.json({ bot });
};

export const updatePaperTradingConfig = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const botId = req.params.id;
  const { paperTrading, paperBalance, riskLimits } = req.body;
  
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) {
    res.status(404).json({ message: 'Bot not found' });
    return;
  }
  
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
  res.json({ bot });
};

export const deleteBot = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const botId = req.params.id;
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) {
    res.status(404).json({ message: 'Bot not found' });
    return;
  }
  
  try {
    // Stop the bot job if it's running
    if (bot.status === 'running') {
      stopBotJob(botId);
    }
    
    // Delete the bot
    await Bot.findByIdAndDelete(botId);
    
    // Delete associated logs
    await BotLog.deleteMany({ bot: botId });
    
    res.json({ message: 'Bot deleted' });
  } catch (error) {
    console.error('Error deleting bot:', error);
    res.status(500).json({ message: 'Failed to delete bot', error: (error as Error).message });
  }
};

export const toggleBot = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const botId = req.params.id;
  const { action } = req.body;
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) {
    res.status(404).json({ message: 'Bot not found' });
    return;
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
      res.status(400).json({ message: 'Invalid action' });
      return;
    }
    
    await bot.save();
    res.json({ bot });
  } catch (error) {
    console.error('Error toggling bot:', error);
    
    // Log the error
    await BotLog.create({
      bot: bot._id,
      timestamp: new Date(),
      type: 'error',
      message: `Failed to ${action} bot`,
      data: { error: (error as Error).message },
    });
    
    res.status(500).json({ message: `Failed to ${action} bot`, error: (error as Error).message });
  }
};

export const getBotLogs = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const botId = req.params.id;
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) {
    res.status(404).json({ message: 'Bot not found' });
    return;
  }
  const logs = await BotLog.find({ bot: botId }).sort({ timestamp: -1 });
  res.json({ logs });
};

export const getBotPerformance = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const botId = req.params.id;
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) {
    res.status(404).json({ message: 'Bot not found' });
    return;
  }
  res.json({ performance: bot.performance });
};

export const backtestBot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { symbol, shortPeriod, longPeriod, quantity, initialBalance, interval, limit, exchange = 'binance' } = req.body;
    // Validate input (add more as needed)
    if (!symbol || !shortPeriod || !longPeriod || !quantity || !initialBalance || !interval) {
      res.status(400).json({ message: 'Missing required parameters' });
      return;
    }
    
    // Create exchange service for backtesting (using public endpoints)
    const exchangeService = ExchangeFactory.createExchange(exchange, {
      apiKey: '',
      apiSecret: ''
    });
    
    // Fetch historical data
    const candles = await exchangeService.fetchKlines(symbol, interval, limit || 100);
    // Run backtest
    const params: BacktestParams = { symbol, shortPeriod, longPeriod, quantity, initialBalance };
    const result = runMovingAverageBacktest(candles, params);
    res.json(result);
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({ message: 'Backtest failed', error: (error as Error).message });
  }
};

export const testBotRun = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string })?.id;
    const botId = req.params.id;
    const bot = await Bot.findOne({ _id: botId, user: userId });
    if (!bot) {
      res.status(404).json({ message: 'Bot not found' });
      return;
    }
    
    const apiKey = await ApiKey.findById(bot.apiKeyRef);
    if (!apiKey) {
      res.status(400).json({ message: 'API key not found' });
      return;
    }
    
    // Import and run the bot
    const { runBot } = await import('../services/botRunner');
    await runBot(bot, apiKey);
    
    res.json({ message: 'Bot test run completed successfully' });
  } catch (error) {
    console.error('Test bot run error:', error);
    res.status(500).json({ message: 'Test run failed', error: (error as Error).message });
  }
};

export const getPaperTrades = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const botId = req.params.id;
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) {
    res.status(404).json({ message: 'Bot not found' });
    return;
  }
  const trades = await PaperTrade.find({ bot: botId }).sort({ timestamp: -1 });
  res.json({ trades });
};

export const getPaperTradingStats = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const botId = req.params.id;
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) {
    res.status(404).json({ message: 'Bot not found' });
    return;
  }

  // Get recent paper trades
  const recentTrades = await PaperTrade.find({ 
    bot: botId,
    timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
  }).sort({ timestamp: -1 });

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

  res.json({ stats });
};

export const updateBotApiKey = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const botId = req.params.id;
  const { apiKeyRef } = req.body;
  
  if (!apiKeyRef) {
    res.status(400).json({ message: 'API key reference is required' });
    return;
  }
  
  const bot = await Bot.findOne({ _id: botId, user: userId });
  if (!bot) {
    res.status(404).json({ message: 'Bot not found' });
    return;
  }
  
  // Verify the new API key exists and belongs to the user
  const apiKey = await ApiKey.findOne({ _id: apiKeyRef, user: userId });
  if (!apiKey) {
    res.status(400).json({ message: 'Invalid API key reference' });
    return;
  }
  
  // Update the bot's API key reference
  bot.apiKeyRef = apiKeyRef;
  await bot.save();
  
  res.json({ bot });
}; 