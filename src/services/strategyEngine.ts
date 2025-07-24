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
export function runMovingAverageBacktest(candles: Candle[], params: any): BacktestResult {
    const { shortPeriod, longPeriod, quantity, initialBalance, marketType = 'spot', leverage = 1, positionSide = 'both' } = params;
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
            if (positionSide === 'short') continue; // Block long
            if (balance >= price * quantity) {
                balance -= price * quantity;
                position += quantity;
                trades.push({ time: candles[i].time, price, side: 'buy', quantity, balance });
                lastSignal = 'buy';
            }
        }
        // Sell signal
        if (shortMA < longMA && lastSignal !== 'sell' && position >= quantity) {
            if (positionSide === 'long') continue; // Block short
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
    let pnl = balance - initialBalance;
    if (marketType === 'futures') {
        pnl *= leverage;
    }
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
export function runRSIBacktest(candles: Candle[], params: any): BacktestResult {
    const { period, overbought, oversold, quantity, initialBalance, marketType = 'spot', leverage = 1, positionSide = 'both' } = params;
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
            if (positionSide === 'short') continue; // Block long
            signal = 'buy';
        }
        // Sell signal: RSI crosses below overbought level
        else if (currentRSI < overbought && lastSignal !== 'sell' && position > 0) {
            if (positionSide === 'long') continue; // Block short
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
    let pnl = balance - initialBalance;
    if (marketType === 'futures') {
        pnl *= leverage;
    }
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

// --- Modular Signal Generators ---

/**
 * Moving Average Crossover Signal Generator
 * @param candles Array of Candle objects
 * @param state Any state object (can be used for last signal, etc.)
 * @param params { shortPeriod, longPeriod }
 * @returns 'buy' | 'sell' | null
 */
export function generateMovingAverageSignal(
    candles: Candle[],
    state: any,
    params: { shortPeriod: number; longPeriod: number }
): 'buy' | 'sell' | null {
    const closes = candles.map(c => c.close);
    if (closes.length < Math.max(params.shortPeriod, params.longPeriod)) return null;
    const shortMA = calculateSMA(closes, params.shortPeriod);
    const longMA = calculateSMA(closes, params.longPeriod);
    if (shortMA === null || longMA === null) return null;
    if (shortMA > longMA && state?.lastSignal !== 'buy') return 'buy';
    if (shortMA < longMA && state?.lastSignal !== 'sell') return 'sell';
    return null;
}

/**
 * RSI Signal Generator
 * @param candles Array of Candle objects
 * @param state Any state object
 * @param params { period, overbought, oversold }
 * @returns 'buy' | 'sell' | null
 */
export function generateRSISignal(
    candles: Candle[],
    state: any,
    params: { period: number; overbought: number; oversold: number }
): 'buy' | 'sell' | null {
    const closes = candles.map(c => c.close);
    const rsiArr = calculateRSI(closes, params.period);
    if (rsiArr.length === 0) return null;
    const rsi = rsiArr[rsiArr.length - 1];
    if (rsi < params.oversold && state?.lastSignal !== 'buy') return 'buy';
    if (rsi > params.overbought && state?.lastSignal !== 'sell') return 'sell';
    return null;
}

// --- Utility: Simple Moving Average ---
function calculateSMA(data: number[], period: number): number | null {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((sum, value) => sum + value, 0) / period;
}

// --- ATR Calculation ---
/**
 * Calculate ATR (Average True Range)
 * @param candles Array of Candle objects
 * @param period ATR period (default: 14)
 * @returns Array of ATR values
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
    if (candles.length < period + 1) return [];
    const atr: number[] = [];
    for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        const tr = Math.max(
            curr.high - curr.low,
            Math.abs(curr.high - prev.close),
            Math.abs(curr.low - prev.close)
        );
        atr.push(tr);
    }
    // First ATR is SMA of first 'period' TRs
    const atrVals: number[] = [];
    let sum = 0;
    for (let i = 0; i < atr.length; i++) {
        sum += atr[i];
        if (i >= period - 1) {
            if (i >= period) sum -= atr[i - period];
            atrVals.push(sum / period);
        }
    }
    return atrVals;
}

// --- Strategy Registry ---
export const strategyRegistry: Record<string, Function> = {
    'moving_average': generateMovingAverageSignal,
    'rsi': generateRSISignal,
    // Add more strategies here
}; 

/**
 * Unified Backtest Runner
 * Runs any registered strategy over historical candles
 * @param strategyName Name of the strategy in the registry
 * @param candles Array of Candle objects (historical data)
 * @param params Parameters for the strategy
 * @param initialBalance Starting balance for simulation
 * @returns { trades, pnl, winRate, finalBalance }
 */
export function runStrategyBacktest(
    strategyName: string,
    candles: Candle[],
    params: any,
    initialBalance: number = 1000
): BacktestResult {
    const strategyFn = strategyRegistry[strategyName];
    if (!strategyFn) throw new Error(`Strategy ${strategyName} not found`);
    let balance = initialBalance;
    let position = 0;
    let lastSignal: 'buy' | 'sell' | null = null;
    const trades: TradeLog[] = [];

    for (let i = 0; i < candles.length; i++) {
        const signal = strategyFn(candles.slice(0, i + 1), { lastSignal }, params);
        const price = candles[i].close;
        // Buy
        if (signal === 'buy' && lastSignal !== 'buy' && balance >= price * (params.quantity || 1)) {
            const qty = params.quantity || 1;
            balance -= price * qty;
            position += qty;
            trades.push({ time: candles[i].time, price, side: 'buy', quantity: qty, balance });
            lastSignal = 'buy';
        }
        // Sell
        if (signal === 'sell' && lastSignal !== 'sell' && position > 0) {
            const qty = position;
            balance += price * qty;
            position = 0;
            trades.push({ time: candles[i].time, price, side: 'sell', quantity: qty, balance });
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
 * Interpret a config-based strategy (visual builder)
 * @param candles Array of Candle objects
 * @param state Bot state (lastSignal, etc.)
 * @param config { indicators: [...], rules: [...], risk: {...} }
 * @returns 'buy' | 'sell' | null
 */
export function interpretConfigStrategy(
    candles: Candle[],
    state: any,
    config: { indicators: any[]; rules: any[]; risk: any }
): 'buy' | 'sell' | null {
    // 1. Compute indicator values
    const indicatorValues: Record<string, any> = {};
    for (const ind of config.indicators) {
        const closes = candles.map(c => c.close);
        if (ind.type === 'SMA') {
            indicatorValues[`SMA_${ind.id}`] = calculateSMA(closes, ind.params.period);
        } else if (ind.type === 'EMA') {
            const emaArr = calculateEMA(closes, ind.params.period);
            indicatorValues[`EMA_${ind.id}`] = emaArr.length > 0 ? emaArr[emaArr.length - 1] : null;
        } else if (ind.type === 'RSI') {
            const rsiArr = calculateRSI(closes, ind.params.period);
            indicatorValues[`RSI_${ind.id}`] = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : null;
        } else if (ind.type === 'MACD') {
            const macd = calculateMACD(closes, ind.params.fast, ind.params.slow, ind.params.signal);
            indicatorValues[`MACD_${ind.id}`] = macd.macd.length > 0 ? macd.macd[macd.macd.length - 1] : null;
        } else if (ind.type === 'BollingerBands') {
            const bb = calculateBollingerBands(closes, ind.params.period, ind.params.stdDev);
            indicatorValues[`BB_upper_${ind.id}`] = bb.upper.length > 0 ? bb.upper[bb.upper.length - 1] : null;
            indicatorValues[`BB_middle_${ind.id}`] = bb.middle.length > 0 ? bb.middle[bb.middle.length - 1] : null;
            indicatorValues[`BB_lower_${ind.id}`] = bb.lower.length > 0 ? bb.lower[bb.lower.length - 1] : null;
        } else if (ind.type === 'VOLUME') {
            // Latest candle's volume
            indicatorValues[`VOLUME_${ind.id}`] = candles.length > 0 ? candles[candles.length - 1].volume : null;
            // Optionally, average volume over lookback
            if (ind.params && ind.params.lookback) {
                const vols = candles.slice(-ind.params.lookback).map(c => c.volume);
                indicatorValues[`VOLUME_AVG_${ind.id}`] = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
            }
        } else if (ind.type === 'ATR') {
            const atrArr = calculateATR(candles, ind.params.period);
            indicatorValues[`ATR_${ind.id}`] = atrArr.length > 0 ? atrArr[atrArr.length - 1] : null;
        }
    }
    // 2. Evaluate rules (simple parser: replace indicator names with values, eval condition)
    for (const rule of config.rules) {
        let cond = rule.condition;
        // Replace indicator references in the condition string
        for (const ind of config.indicators) {
            const key = `${ind.type}_${ind.id}`;
            cond = cond.replaceAll(`${ind.type}(${ind.params.period || ind.params.fast || ind.params.slow || ind.params.signal || ind.params.stdDev || ''})`, indicatorValues[key]);
            cond = cond.replaceAll(key, indicatorValues[key]);
        }
        // Also support BB_upper, BB_middle, BB_lower
        for (const ind of config.indicators.filter(i => i.type === 'BollingerBands')) {
            cond = cond.replaceAll(`BB_upper_${ind.id}`, indicatorValues[`BB_upper_${ind.id}`]);
            cond = cond.replaceAll(`BB_middle_${ind.id}`, indicatorValues[`BB_middle_${ind.id}`]);
            cond = cond.replaceAll(`BB_lower_${ind.id}`, indicatorValues[`BB_lower_${ind.id}`]);
        }
        // Evaluate the condition (safe eval)
        try {
            // Only allow numbers, operators, and parentheses
            if (/^[0-9.\s><=+\-*/()]+$/.test(cond)) {
                // eslint-disable-next-line no-eval
                if (eval(cond)) {
                    return rule.action;
                }
            }
        } catch (e) {
            // Ignore invalid rule
        }
    }
    return null;
} 