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

export interface RSIBacktestParams {
  symbol: string;
  period: number;
  overbought: number;
  oversold: number;
  quantity: number;
  initialBalance: number;
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

/**
 * Calculate RSI (Relative Strength Index)
 * @param prices Array of closing prices
 * @param period RSI period (default: 14)
 * @returns RSI value between 0 and 100
 */
export function calculateRSI(prices: number[], period: number = 14): number[] {
  if (prices.length < period + 1) {
    return [];
  }

  const rsi: number[] = [];
  let gains = 0;
  let losses = 0;

  // Calculate initial average gain and loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Calculate RSI for the first period
  const rs = avgGain / avgLoss;
  const firstRSI = 100 - (100 / (1 + rs));
  rsi.push(firstRSI);

  // Calculate RSI for remaining periods using smoothed averages
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    let currentGain = 0;
    let currentLoss = 0;

    if (change > 0) {
      currentGain = change;
    } else {
      currentLoss = Math.abs(change);
    }

    // Smoothed average calculation
    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    const rs = avgGain / avgLoss;
    const currentRSI = 100 - (100 / (1 + rs));
    rsi.push(currentRSI);
  }

  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param prices Array of closing prices
 * @param fastPeriod Fast EMA period (default: 12)
 * @param slowPeriod Slow EMA period (default: 26)
 * @param signalPeriod Signal line period (default: 9)
 * @returns Object with MACD line, signal line, and histogram
 */
export function calculateMACD(
  prices: number[], 
  fastPeriod: number = 12, 
  slowPeriod: number = 26, 
  signalPeriod: number = 9
): { macd: number[], signal: number[], histogram: number[] } {
  if (prices.length < slowPeriod + signalPeriod) {
    return { macd: [], signal: [], histogram: [] };
  }

  // Calculate EMAs
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  // Calculate MACD line
  const macd: number[] = [];
  for (let i = 0; i < Math.min(fastEMA.length, slowEMA.length); i++) {
    macd.push(fastEMA[i] - slowEMA[i]);
  }

  // Calculate signal line (EMA of MACD)
  const signal = calculateEMA(macd, signalPeriod);

  // Calculate histogram
  const histogram: number[] = [];
  for (let i = 0; i < Math.min(macd.length, signal.length); i++) {
    histogram.push(macd[i] - signal[i]);
  }

  return { macd, signal, histogram };
}

/**
 * Calculate EMA (Exponential Moving Average)
 * @param prices Array of prices
 * @param period EMA period
 * @returns Array of EMA values
 */
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) {
    return [];
  }

  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema.push(sum / period);

  // Calculate EMA for remaining periods
  for (let i = period; i < prices.length; i++) {
    const currentEMA = (prices[i] * multiplier) + (ema[ema.length - 1] * (1 - multiplier));
    ema.push(currentEMA);
  }

  return ema;
}

/**
 * Calculate Bollinger Bands
 * @param prices Array of closing prices
 * @param period Period for SMA (default: 20)
 * @param stdDev Standard deviation multiplier (default: 2)
 * @returns Object with upper band, middle band (SMA), and lower band
 */
export function calculateBollingerBands(
  prices: number[], 
  period: number = 20, 
  stdDev: number = 2
): { upper: number[], middle: number[], lower: number[] } {
  if (prices.length < period) {
    return { upper: [], middle: [], lower: [] };
  }

  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const sma = slice.reduce((sum, price) => sum + price, 0) / period;
    
    // Calculate standard deviation
    const variance = slice.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);

    middle.push(sma);
    upper.push(sma + (standardDeviation * stdDev));
    lower.push(sma - (standardDeviation * stdDev));
  }

  return { upper, middle, lower };
}

/**
 * Calculate Stochastic Oscillator
 * @param highPrices Array of high prices
 * @param lowPrices Array of low prices
 * @param closePrices Array of closing prices
 * @param kPeriod %K period (default: 14)
 * @param dPeriod %D period (default: 3)
 * @returns Object with %K and %D values
 */
export function calculateStochastic(
  highPrices: number[], 
  lowPrices: number[], 
  closePrices: number[], 
  kPeriod: number = 14, 
  dPeriod: number = 3
): { k: number[], d: number[] } {
  if (highPrices.length < kPeriod || lowPrices.length < kPeriod || closePrices.length < kPeriod) {
    return { k: [], d: [] };
  }

  const k: number[] = [];
  const d: number[] = [];

  // Calculate %K
  for (let i = kPeriod - 1; i < closePrices.length; i++) {
    const highSlice = highPrices.slice(i - kPeriod + 1, i + 1);
    const lowSlice = lowPrices.slice(i - kPeriod + 1, i + 1);
    
    const highestHigh = Math.max(...highSlice);
    const lowestLow = Math.min(...lowSlice);
    const currentClose = closePrices[i];

    const kValue = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    k.push(kValue);
  }

  // Calculate %D (SMA of %K)
  for (let i = dPeriod - 1; i < k.length; i++) {
    const kSlice = k.slice(i - dPeriod + 1, i + 1);
    const dValue = kSlice.reduce((sum, val) => sum + val, 0) / dPeriod;
    d.push(dValue);
  }

  return { k, d };
}

/**
 * RSI Strategy Backtest
 * Buy when RSI crosses above oversold level, sell when RSI crosses below overbought level
 */
export function runRSIBacktest(candles: Candle[], params: RSIBacktestParams): BacktestResult {
  const { period, overbought, oversold, quantity, initialBalance } = params;
  let balance = initialBalance;
  let position = 0;
  let lastSignal: 'buy' | 'sell' | null = null;
  const trades: TradeLog[] = [];

  // Calculate RSI
  const closes = candles.map(c => c.close);
  const rsiValues = calculateRSI(closes, period);

  if (rsiValues.length === 0) {
    return { trades: [], pnl: 0, winRate: 0, finalBalance: initialBalance };
  }

  // Start from the point where we have RSI values
  const startIndex = period + 1;
  
  for (let i = startIndex; i < candles.length; i++) {
    const rsiIndex = i - startIndex;
    if (rsiIndex >= rsiValues.length) break;

    const currentRSI = rsiValues[rsiIndex];
    const price = candles[i].close;
    let signal: 'buy' | 'sell' | null = null;

    // Buy signal: RSI crosses above oversold level
    if (currentRSI > oversold && lastSignal !== 'buy' && position === 0) {
      signal = 'buy';
    }
    // Sell signal: RSI crosses below overbought level
    else if (currentRSI < overbought && lastSignal !== 'sell' && position > 0) {
      signal = 'sell';
    }

    // Execute trades
    if (signal === 'buy' && balance >= price * quantity) {
      balance -= price * quantity;
      position += quantity;
      trades.push({ 
        time: candles[i].time, 
        price, 
        side: 'buy', 
        quantity, 
        balance 
      });
      lastSignal = 'buy';
    } else if (signal === 'sell' && position >= quantity) {
      balance += price * quantity;
      position -= quantity;
      trades.push({ 
        time: candles[i].time, 
        price, 
        side: 'sell', 
        quantity, 
        balance 
      });
      lastSignal = 'sell';
    }
  }

  // Close any open position at the end
  if (position > 0) {
    const price = candles[candles.length - 1].close;
    balance += price * position;
    trades.push({ 
      time: candles[candles.length - 1].time, 
      price, 
      side: 'sell', 
      quantity: position, 
      balance 
    });
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