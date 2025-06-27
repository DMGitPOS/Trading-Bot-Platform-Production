import { Spot, Interval } from '@binance/connector-typescript';
import { Candle } from './strategyEngine';

export async function fetchBinanceKlines(
  symbol: string,
  interval: Interval,
  limit: number = 100
): Promise<Candle[]> {
  // You can use public endpoints for historical klines (no API key needed)
  const client = new Spot();
  const klines = await client.uiklines(symbol, interval, { limit });
  return klines.map((kline: any[]) => ({
    time: kline[0],
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5]),
  }));
} 