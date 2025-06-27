import { IBot } from '../models/Bot';
import { IApiKey } from '../models/ApiKey';
import { fetchBinanceKlines } from './binanceDataService';
import { runMovingAverageBacktest } from './strategyEngine';
import { Interval } from '@binance/connector-typescript';

/**
 * Runs the bot's strategy using live Binance data and updates performance.
 * @param bot Bot document
 * @param apiKey ApiKey document
 */
export async function runBot(bot: IBot, apiKey: IApiKey): Promise<void> {
  // Example: Only support moving average strategy for now
  const { symbol, shortPeriod, longPeriod, quantity, initialBalance } = bot.strategy as any;
  if (!symbol || !shortPeriod || !longPeriod || !quantity || !initialBalance) {
    throw new Error('Bot strategy parameters missing');
  }
  // Fetch recent klines (e.g., 100 1m candles)
  const candles = await fetchBinanceKlines(symbol, Interval["1m"], 100);
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