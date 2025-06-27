export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestParams {
  symbol: string;
  shortPeriod: number;
  longPeriod: number;
  quantity: number;
  initialBalance: number;
}

export interface TradeLog {
  time: number;
  price: number;
  side: 'buy' | 'sell';
  quantity: number;
  balance: number;
}

export interface BacktestResult {
  trades: TradeLog[];
  pnl: number;
  winRate: number;
  finalBalance: number;
}

// Utility: Convert Binance kline data to Candle[]
export function binanceKlinesToCandles(klines: any[]): Candle[] {
  return klines.map((kline) => ({
    time: kline[0],
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5]),
  }));
}

// Simple moving average crossover strategy
export function runMovingAverageBacktest(candles: Candle[], params: BacktestParams): BacktestResult {
  const { shortPeriod, longPeriod, quantity, initialBalance } = params;
  let balance = initialBalance;
  let position = 0;
  let lastSignal: 'buy' | 'sell' | null = null;
  const trades: TradeLog[] = [];

  // Calculate moving averages
  function sma(data: number[], period: number, idx: number) {
    if (idx < period - 1) return null;
    const slice = data.slice(idx - period + 1, idx + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  const closes = candles.map(c => c.close);

  for (let i = 0; i < candles.length; i++) {
    const shortMA = sma(closes, shortPeriod, i);
    const longMA = sma(closes, longPeriod, i);
    if (shortMA === null || longMA === null) continue;
    const price = candles[i].close;
    // Buy signal
    if (shortMA > longMA && lastSignal !== 'buy') {
      if (balance >= price * quantity) {
        balance -= price * quantity;
        position += quantity;
        trades.push({ time: candles[i].time, price, side: 'buy', quantity, balance });
        lastSignal = 'buy';
      }
    }
    // Sell signal
    if (shortMA < longMA && lastSignal !== 'sell' && position >= quantity) {
      balance += price * quantity;
      position -= quantity;
      trades.push({ time: candles[i].time, price, side: 'sell', quantity, balance });
      lastSignal = 'sell';
    }
  }

  // Close any open position at the end
  if (position > 0) {
    const price = candles[candles.length - 1].close;
    balance += price * position;
    trades.push({ time: candles[candles.length - 1].time, price, side: 'sell', quantity: position, balance });
    position = 0;
  }

  // Calculate PnL and win rate
  const pnl = balance - initialBalance;
  let wins = 0, total = 0;
  for (let i = 1; i < trades.length; i += 2) {
    if (trades[i].side === 'sell' && trades[i - 1].side === 'buy') {
      if (trades[i].price > trades[i - 1].price) wins++;
      total++;
    }
  }
  const winRate = total > 0 ? wins / total : 0;

  return { trades, pnl, winRate, finalBalance: balance };
} 