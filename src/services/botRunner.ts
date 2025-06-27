import { IBot } from '../models/Bot';
import { IApiKey } from '../models/ApiKey';
import { runMovingAverageBacktest } from './strategyEngine';
import { ExchangeFactory } from './exchange/ExchangeFactory';
import { decrypt } from '../utils/crypto';

/**
 * Runs the bot's strategy using live exchange data and updates performance.
 * @param bot Bot document
 * @param apiKey ApiKey document
 */
export async function runBot(bot: IBot, apiKey: IApiKey): Promise<void> {
  // Example: Only support moving average strategy for now
  const { symbol, shortPeriod, longPeriod, quantity, initialBalance, interval = '1m' } = bot.strategy as any;
  if (!symbol || !shortPeriod || !longPeriod || !quantity || !initialBalance) {
    throw new Error('Bot strategy parameters missing');
  }

  // Create exchange service using factory
  const credentials = {
    apiKey: decrypt(apiKey.apiKey),
    apiSecret: decrypt(apiKey.apiSecret),
  };
  
  const exchangeService = ExchangeFactory.createExchange(bot.exchange, credentials);
  
  // Fetch recent klines using the exchange service
  const candles = await exchangeService.fetchKlines(symbol, interval, 100);
  
  // Run strategy
  const result = runMovingAverageBacktest(candles, {
    symbol,
    shortPeriod,
    longPeriod,
    quantity,
    initialBalance,
  });
  
  // Update bot performance
  bot.performance = {
    pnl: result.pnl,
    winRate: result.winRate,
    tradeCount: result.trades.length,
    lastTradeAt: new Date(),
  };
  await bot.save();
} 