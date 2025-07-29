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
    const { 
        shortPeriod, 
        longPeriod, 
        quantity, 
        initialBalance, 
        marketType = 'spot', 
        leverage = 1, 
        positionSide = 'both',
        // Enhanced features
        volatilityConfig,
        drawdownConfig,
        confirmationSignals,
    } = params;
    
    let balance = initialBalance;
    let position = 0;
    let entryPrice = 0; // Track entry price for PnL calculation
    let lastSignal: 'buy' | 'sell' | null = null;
    const trades: TradeLog[] = [];

    // Enhanced features state
    let drawdownState: DrawdownState = {
        peakBalance: initialBalance,
        currentDrawdown: 0,
        maxDrawdownReached: 0,
        lastPeakTime: Date.now(),
    };
    let volatilityRegime: 'low' | 'normal' | 'high' = 'normal';
    let lastVolatilityCheck = 0;

    // Helper function to round to 8 decimal places (standard for crypto)
    const roundTo8 = (num: number): number => Math.round(num * 100000000) / 100000000;

    // Calculate moving averages
    function sma(data: number[], period: number, idx: number) {
        if (idx < period - 1) return null;
        const slice = data.slice(idx - period + 1, idx + 1);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    const closes = candles.map(c => c.close);

    for (let i = 0; i < candles.length; i++) {
        const currentTime = candles[i].time;
        
        // Check drawdown protection
        if (drawdownConfig?.enabled) {
            const drawdownResult = updateDrawdownState(drawdownState, balance, drawdownConfig);
            if (drawdownResult.shouldStop) {
                // Stop trading due to drawdown limit
                break;
            }
            drawdownState = {
                ...drawdownState,
                currentDrawdown: calculateDrawdown(balance, drawdownState.peakBalance),
            };
        }

        // Check volatility regime every 5 minutes (300000ms)
        if (volatilityConfig?.enabled && currentTime - lastVolatilityCheck > 300000) {
            const availableCandles = candles.slice(0, i + 1);
            if (availableCandles.length >= volatilityConfig.atrPeriod) {
                volatilityRegime = detectVolatilityRegime(availableCandles, volatilityConfig);
            }
            lastVolatilityCheck = currentTime;
        }

        // Get volatility-adjusted parameters
        let adjustedShortPeriod = shortPeriod;
        let adjustedLongPeriod = longPeriod;
        let adjustedQuantity = quantity;
        
        if (volatilityConfig?.enabled) {
            const adjustedParams = getVolatilityAdjustedParams(
                { shortPeriod, longPeriod, quantity },
                volatilityRegime,
                volatilityConfig
            );
            adjustedShortPeriod = adjustedParams.shortPeriod;
            adjustedLongPeriod = adjustedParams.longPeriod;
            adjustedQuantity = adjustedParams.quantity;
        }

        const shortMA = sma(closes, adjustedShortPeriod, i);
        const longMA = sma(closes, adjustedLongPeriod, i);
        if (shortMA === null || longMA === null) continue;
        const price = candles[i].close;
        
        // Determine signal based on MA crossover with enhanced features
        let signal: 'buy' | 'sell' | null = null;
        if (shortMA > longMA) {
            signal = 'buy'; // Bullish signal
        } else if (shortMA < longMA) {
            signal = 'sell'; // Bearish signal
        }

        // Apply confirmation signals if enabled
        if (signal && confirmationSignals) {
            const conf = confirmationSignals;
            
            // RSI confirmation
            if (conf.useRSI) {
                const rsiValues = calculateRSI(closes, conf.rsiPeriod);
                if (rsiValues.length > i) {
                    const currentRSI = rsiValues[i];
                    if (signal === 'buy' && currentRSI > conf.rsiOverbought) {
                        signal = null; // Avoid buying in overbought conditions
                    } else if (signal === 'sell' && currentRSI < conf.rsiOversold) {
                        signal = null; // Avoid selling in oversold conditions
                    }
                }
            }
            
            // Volume confirmation
            if (signal && conf.useVolume) {
                const volumes = candles.map(c => c.volume);
                const avgVolume = volumes.slice(Math.max(0, i - 20), i + 1).reduce((a, b) => a + b, 0) / Math.min(21, i + 1);
                const currentVolume = candles[i].volume;
                if (currentVolume < avgVolume * conf.volumeThreshold) {
                    signal = null; // Insufficient volume
                }
            }
            
            // Trend strength confirmation
            if (signal && conf.useTrendStrength) {
                const trendStrength = Math.abs(shortMA - longMA) / longMA * 100;
                if (trendStrength < conf.minTrendStrength) {
                    signal = null; // Trend too weak
                }
            }
        }

        // Apply position side filtering
        if (positionSide === 'long' && signal === 'sell') {
            signal = null; // Block bearish signals for long-only
        } else if (positionSide === 'short' && signal === 'buy') {
            signal = null; // Block bullish signals for short-only
        }

        // Execute trades based on market type and position
        if (marketType === 'futures') {
            // Futures trading logic
            if (signal === 'buy' && position <= 0) {
                // Open long position or close short position
                if (position < 0) {
                    // Close short position first - calculate PnL
                    const shortPnL = (entryPrice - price) * Math.abs(position);
                    balance = roundTo8(balance + shortPnL);
                    trades.push({ time: candles[i].time, price, side: 'buy', quantity: Math.abs(position), balance });
                }
                // Open long position - only use margin
                const margin = roundTo8((price * adjustedQuantity) / leverage);
                balance = roundTo8(balance - margin);
                position = adjustedQuantity;
                entryPrice = price; // Set entry price for long position
                trades.push({ time: candles[i].time, price, side: 'buy', quantity: adjustedQuantity, balance });
                lastSignal = 'buy';
            } else if (signal === 'sell' && position >= 0) {
                // Open short position or close long position
                if (position > 0) {
                    // Close long position first - calculate PnL
                    const longPnL = (price - entryPrice) * position;
                    balance = roundTo8(balance + longPnL);
                    trades.push({ time: candles[i].time, price, side: 'sell', quantity: position, balance });
                }
                // Open short position - only use margin
                const margin = roundTo8((price * adjustedQuantity) / leverage);
                balance = roundTo8(balance - margin);
                position = -adjustedQuantity;
                entryPrice = price; // Set entry price for short position
                trades.push({ time: candles[i].time, price, side: 'sell', quantity: adjustedQuantity, balance });
                lastSignal = 'sell';
            }
        } else {
            // Spot trading logic (original behavior)
            if (signal === 'buy' && lastSignal !== 'buy' && balance >= price * adjustedQuantity) {
                balance = roundTo8(balance - price * adjustedQuantity);
                position += adjustedQuantity;
                trades.push({ time: candles[i].time, price, side: 'buy', quantity: adjustedQuantity, balance });
                lastSignal = 'buy';
            } else if (signal === 'sell' && lastSignal !== 'sell' && position >= adjustedQuantity) {
                balance = roundTo8(balance + price * adjustedQuantity);
                position -= adjustedQuantity;
                trades.push({ time: candles[i].time, price, side: 'sell', quantity: adjustedQuantity, balance });
                lastSignal = 'sell';
            }
        }

        // Update drawdown state
        if (balance > drawdownState.peakBalance) {
            drawdownState.peakBalance = balance;
            drawdownState.lastPeakTime = currentTime;
        }
    }

    // Close any open position at the end
    if (position !== 0) {
        const price = candles[candles.length - 1].close;
        if (position > 0) {
            // Close long position
            const longPnL = (price - entryPrice) * position;
            balance = roundTo8(balance + longPnL);
            trades.push({ time: candles[candles.length - 1].time, price, side: 'sell', quantity: position, balance });
        } else {
            // Close short position
            const shortPnL = (entryPrice - price) * Math.abs(position);
            balance = roundTo8(balance + shortPnL);
            trades.push({ time: candles[candles.length - 1].time, price, side: 'buy', quantity: Math.abs(position), balance });
        }
        position = 0;
    }

    // Calculate PnL and win rate
    let pnl = roundTo8(balance - initialBalance);
    let wins = 0, total = 0;
    for (let i = 1; i < trades.length; i += 2) {
        if (trades[i].side === 'sell' && trades[i - 1].side === 'buy') {
            if (trades[i].price > trades[i - 1].price) wins++;
            total++;
        } else if (trades[i].side === 'buy' && trades[i - 1].side === 'sell') {
            // Handle futures short trades
            if (trades[i].price < trades[i - 1].price) wins++;
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
    const { 
        period, 
        overbought, 
        oversold, 
        quantity, 
        initialBalance, 
        marketType = 'spot', 
        leverage = 1, 
        positionSide = 'both',
        // Enhanced features
        volatilityConfig,
        drawdownConfig,
        confirmationSignals,
    } = params;
    
    let balance = initialBalance;
    let position = 0;
    let entryPrice = 0; // Track entry price for PnL calculation
    let lastSignal: 'buy' | 'sell' | null = null;
    const trades: TradeLog[] = [];

    // Enhanced features state
    let drawdownState: DrawdownState = {
        peakBalance: initialBalance,
        currentDrawdown: 0,
        maxDrawdownReached: 0,
        lastPeakTime: Date.now(),
    };
    let volatilityRegime: 'low' | 'normal' | 'high' = 'normal';
    let lastVolatilityCheck = 0;

    // Helper function to round to 8 decimal places (standard for crypto)
    const roundTo8 = (num: number): number => Math.round(num * 100000000) / 100000000;

    // Calculate RSI
    const closes = candles.map(c => c.close);
    const rsiValues = calculateRSI(closes, period);

    if (rsiValues.length === 0) {
        return { trades: [], pnl: 0, winRate: 0, finalBalance: initialBalance };
    }

    // Start from the point where we have RSI values
    const startIndex = period + 1;
    
    for (let i = startIndex; i < candles.length; i++) {
        const currentTime = candles[i].time;
        
        // Check drawdown protection
        if (drawdownConfig?.enabled) {
            const drawdownResult = updateDrawdownState(drawdownState, balance, drawdownConfig);
            if (drawdownResult.shouldStop) {
                // Stop trading due to drawdown limit
                break;
            }
            drawdownState = {
                ...drawdownState,
                currentDrawdown: calculateDrawdown(balance, drawdownState.peakBalance),
            };
        }

        // Check volatility regime every 5 minutes (300000ms)
        if (volatilityConfig?.enabled && currentTime - lastVolatilityCheck > 300000) {
            const availableCandles = candles.slice(0, i + 1);
            if (availableCandles.length >= volatilityConfig.atrPeriod) {
                volatilityRegime = detectVolatilityRegime(availableCandles, volatilityConfig);
            }
            lastVolatilityCheck = currentTime;
        }

        // Get volatility-adjusted parameters
        let adjustedQuantity = quantity;
        if (volatilityConfig?.enabled) {
            const adjustedParams = getVolatilityAdjustedParams(
                { quantity },
                volatilityRegime,
                volatilityConfig
            );
            adjustedQuantity = adjustedParams.quantity;
        }

        const rsiIndex = i - startIndex;
        if (rsiIndex >= rsiValues.length) break;

        const currentRSI = rsiValues[rsiIndex];
        const price = candles[i].close;
        let signal: 'buy' | 'sell' | null = null;

        // Determine signal based on RSI levels
        if (currentRSI > oversold && currentRSI < overbought) {
            // RSI is in neutral zone, no signal
            signal = null;
        } else if (currentRSI <= oversold) {
            signal = 'buy'; // Bullish signal (oversold)
        } else if (currentRSI >= overbought) {
            signal = 'sell'; // Bearish signal (overbought)
        }

        // Apply confirmation signals if enabled
        if (signal && confirmationSignals) {
            const conf = confirmationSignals;
            
            // Volume confirmation
            if (conf.useVolume) {
                const volumes = candles.map(c => c.volume);
                const avgVolume = volumes.slice(Math.max(0, i - 20), i + 1).reduce((a, b) => a + b, 0) / Math.min(21, i + 1);
                const currentVolume = candles[i].volume;
                if (currentVolume < avgVolume * conf.volumeThreshold) {
                    signal = null; // Insufficient volume
                }
            }
            
            // Trend strength confirmation (using RSI trend)
            if (signal && conf.useTrendStrength) {
                const rsiTrend = Math.abs(currentRSI - 50) / 50 * 100; // Distance from neutral 50
                if (rsiTrend < conf.minTrendStrength) {
                    signal = null; // RSI trend too weak
                }
            }
        }

        // Apply position side filtering
        if (positionSide === 'long' && signal === 'sell') {
            signal = null; // Block bearish signals for long-only
        } else if (positionSide === 'short' && signal === 'buy') {
            signal = null; // Block bullish signals for short-only
        }

        // Execute trades based on market type and position
        if (marketType === 'futures') {
            // Futures trading logic
            if (signal === 'buy' && position <= 0) {
                // Open long position or close short position
                if (position < 0) {
                    // Close short position first - calculate PnL
                    const shortPnL = (entryPrice - price) * Math.abs(position);
                    balance = roundTo8(balance + shortPnL);
                    trades.push({ time: candles[i].time, price, side: 'buy', quantity: Math.abs(position), balance });
                }
                // Open long position - only use margin
                const margin = roundTo8((price * adjustedQuantity) / leverage);
                balance = roundTo8(balance - margin);
                position = adjustedQuantity;
                entryPrice = price; // Set entry price for long position
                trades.push({ time: candles[i].time, price, side: 'buy', quantity: adjustedQuantity, balance });
                lastSignal = 'buy';
            } else if (signal === 'sell' && position >= 0) {
                // Open short position or close long position
                if (position > 0) {
                    // Close long position first - calculate PnL
                    const longPnL = (price - entryPrice) * position;
                    balance = roundTo8(balance + longPnL);
                    trades.push({ time: candles[i].time, price, side: 'sell', quantity: position, balance });
                }
                // Open short position - only use margin
                const margin = roundTo8((price * adjustedQuantity) / leverage);
                balance = roundTo8(balance - margin);
                position = -adjustedQuantity;
                entryPrice = price; // Set entry price for short position
                trades.push({ time: candles[i].time, price, side: 'sell', quantity: adjustedQuantity, balance });
                lastSignal = 'sell';
            }
        } else {
            // Spot trading logic (original behavior)
            if (signal === 'buy' && lastSignal !== 'buy' && position === 0 && balance >= price * adjustedQuantity) {
                balance = roundTo8(balance - price * adjustedQuantity);
                position += adjustedQuantity;
                trades.push({ 
                    time: candles[i].time, 
                    price, 
                    side: 'buy', 
                    quantity: adjustedQuantity, 
                    balance 
                });
                lastSignal = 'buy';
            } else if (signal === 'sell' && lastSignal !== 'sell' && position > 0) {
                balance = roundTo8(balance + price * adjustedQuantity);
                position -= adjustedQuantity;
                trades.push({ 
                    time: candles[i].time, 
                    price, 
                    side: 'sell', 
                    quantity: adjustedQuantity, 
                    balance 
                });
                lastSignal = 'sell';
            }
        }

        // Update drawdown state
        if (balance > drawdownState.peakBalance) {
            drawdownState.peakBalance = balance;
            drawdownState.lastPeakTime = currentTime;
        }
    }

    // Close any open position at the end
    if (position !== 0) {
        const price = candles[candles.length - 1].close;
        if (position > 0) {
            // Close long position
            const longPnL = (price - entryPrice) * position;
            balance = roundTo8(balance + longPnL);
            trades.push({ 
                time: candles[candles.length - 1].time, 
                price, 
                side: 'sell', 
                quantity: position, 
                balance 
            });
        } else {
            // Close short position
            const shortPnL = (entryPrice - price) * Math.abs(position);
            balance = roundTo8(balance + shortPnL);
            trades.push({ 
                time: candles[candles.length - 1].time, 
                price, 
                side: 'buy', 
                quantity: Math.abs(position), 
                balance 
            });
        }
        position = 0;
    }

    // Calculate PnL and win rate
    let pnl = roundTo8(balance - initialBalance);
    let wins = 0, total = 0;
    for (let i = 1; i < trades.length; i += 2) {
        if (trades[i].side === 'sell' && trades[i - 1].side === 'buy') {
            if (trades[i].price > trades[i - 1].price) wins++;
            total++;
        } else if (trades[i].side === 'buy' && trades[i - 1].side === 'sell') {
            // Handle futures short trades
            if (trades[i].price < trades[i - 1].price) wins++;
            total++;
        }
    }
    const winRate = total > 0 ? wins / total : 0;

    return { trades, pnl, winRate, finalBalance: balance };
} 

// --- Modular Signal Generators ---

/**
 * Enhanced Moving Average Crossover Signal Generator with confirmation signals
 * @param candles Array of Candle objects
 * @param state Any state object (can be used for last signal, etc.)
 * @param params { shortPeriod, longPeriod, positionSide?, marketType?, confirmationSignals? }
 * @returns 'buy' | 'sell' | null
 */
export function generateEnhancedMovingAverageSignal(
    candles: Candle[],
    state: any,
    params: { 
        shortPeriod: number; 
        longPeriod: number; 
        positionSide?: string; 
        marketType?: string;
        confirmationSignals?: {
            useRSI: boolean;
            rsiPeriod: number;
            rsiOverbought: number;
            rsiOversold: number;
            useVolume: boolean;
            volumeThreshold: number;
            useTrendStrength: boolean;
            minTrendStrength: number;
        };
    }
): 'buy' | 'sell' | null {
    if (candles.length < Math.max(params.shortPeriod, params.longPeriod)) {
        return null;
    }

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    
    // Calculate moving averages
    const shortMA = calculateSMA(closes, params.shortPeriod);
    const longMA = calculateSMA(closes, params.longPeriod);
    
    if (shortMA === null || longMA === null) {
        return null;
    }

    // Basic MA crossover signal
    let signal: 'buy' | 'sell' | null = null;
    if (shortMA > longMA) {
        signal = 'buy';
    } else if (shortMA < longMA) {
        signal = 'sell';
    }

    // Apply position side filtering
    const positionSide = params.positionSide || 'both';
    if (positionSide === 'long' && signal === 'sell') {
        signal = null;
    } else if (positionSide === 'short' && signal === 'buy') {
        signal = null;
    }

    // Apply confirmation signals if enabled
    if (signal && params.confirmationSignals) {
        const conf = params.confirmationSignals;
        
        // RSI confirmation
        if (conf.useRSI) {
            const rsiValues = calculateRSI(closes, conf.rsiPeriod);
            if (rsiValues.length > 0) {
                const currentRSI = rsiValues[rsiValues.length - 1];
                if (signal === 'buy' && currentRSI > conf.rsiOverbought) {
                    signal = null; // Overbought, don't buy
                } else if (signal === 'sell' && currentRSI < conf.rsiOversold) {
                    signal = null; // Oversold, don't sell
                }
            }
        }
        
        // Volume confirmation
        if (conf.useVolume && signal) {
            const avgVolume = volumes.slice(-20).reduce((sum, vol) => sum + vol, 0) / 20;
            const currentVolume = volumes[volumes.length - 1];
            if (currentVolume < avgVolume * conf.volumeThreshold) {
                signal = null; // Low volume, weak signal
            }
        }
        
        // Trend strength confirmation
        if (conf.useTrendStrength && signal) {
            const trendStrength = Math.abs(shortMA - longMA) / longMA * 100;
            if (trendStrength < conf.minTrendStrength) {
                signal = null; // Weak trend, avoid trading
            }
        }
    }

    // For futures, we need to consider current position
    if (params.marketType === 'futures') {
        const currentPosition = state?.position || 0;
        
        if (signal === 'buy' && currentPosition <= 0) {
            return 'buy';
        } else if (signal === 'sell' && currentPosition >= 0) {
            return 'sell';
        }
        return null;
    } else {
        // Spot trading logic (original behavior)
        if (signal === 'buy' && state?.lastSignal !== 'buy') {
            return 'buy';
        } else if (signal === 'sell' && state?.lastSignal !== 'sell') {
            return 'sell';
        }
        return null;
    }
}

/**
 * RSI Signal Generator
 * @param candles Array of Candle objects
 * @param state Any state object
 * @param params { period, overbought, oversold, positionSide?, marketType? }
 * @returns 'buy' | 'sell' | null
 */
export function generateRSISignal(
    candles: Candle[],
    state: any,
    params: { period: number; overbought: number; oversold: number; positionSide?: string; marketType?: string }
): 'buy' | 'sell' | null {
    const { period, overbought, oversold, positionSide = 'both', marketType = 'spot' } = params;
    const closes = candles.map(c => c.close);
    const rsiArr = calculateRSI(closes, period);
    
    if (rsiArr.length === 0) return null;
    
    const currentRSI = rsiArr[rsiArr.length - 1];
    
    // Determine signal based on RSI levels
    let signal: 'buy' | 'sell' | null = null;
    if (currentRSI > oversold && currentRSI < overbought) {
        // RSI is in neutral zone, no signal
        signal = null;
    } else if (currentRSI <= oversold) {
        signal = 'buy'; // Bullish signal (oversold)
    } else if (currentRSI >= overbought) {
        signal = 'sell'; // Bearish signal (overbought)
    }
    
    // Apply position side filtering
    if (positionSide === 'long' && signal === 'sell') {
        signal = null; // Block bearish signals for long-only
    } else if (positionSide === 'short' && signal === 'buy') {
        signal = null; // Block bullish signals for short-only
    }
    
    // For futures, we need to consider current position
    if (marketType === 'futures') {
        const currentPosition = state?.position || 0;
        
        if (signal === 'buy' && currentPosition <= 0) {
            // Can open long or close short
            return 'buy';
        } else if (signal === 'sell' && currentPosition >= 0) {
            // Can open short or close long
            return 'sell';
        }
        return null;
    } else {
        // Spot trading logic (original behavior)
        if (signal === 'buy' && state?.lastSignal !== 'buy') {
            return 'buy';
        } else if (signal === 'sell' && state?.lastSignal !== 'sell') {
            return 'sell';
        }
        return null;
    }
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
    'moving_average': generateEnhancedMovingAverageSignal,
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
    // 1. Compute indicator values (current and previous)
    const indicatorValues: Record<string, any> = {};
    const indicatorPrevValues: Record<string, any> = {};
    for (const ind of config.indicators) {
        const closes = candles.map(c => c.close);
        if (ind.type === 'SMA') {
            indicatorValues[`SMA_${ind.id}`] = calculateSMA(closes, ind.params.period);
            indicatorPrevValues[`SMA_${ind.id}`] = calculateSMA(closes.slice(0, -1), ind.params.period);
        } else if (ind.type === 'EMA') {
            const emaArr = calculateEMA(closes, ind.params.period);
            indicatorValues[`EMA_${ind.id}`] = emaArr.length > 0 ? emaArr[emaArr.length - 1] : null;
            indicatorPrevValues[`EMA_${ind.id}`] = emaArr.length > 1 ? emaArr[emaArr.length - 2] : null;
        } else if (ind.type === 'RSI') {
            const rsiArr = calculateRSI(closes, ind.params.period);
            indicatorValues[`RSI_${ind.id}`] = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : null;
            indicatorPrevValues[`RSI_${ind.id}`] = rsiArr.length > 1 ? rsiArr[rsiArr.length - 2] : null;
        } else if (ind.type === 'MACD') {
            const macd = calculateMACD(closes, ind.params.fast, ind.params.slow, ind.params.signal);
            indicatorValues[`MACD_${ind.id}`] = macd.macd.length > 0 ? macd.macd[macd.macd.length - 1] : null;
            indicatorPrevValues[`MACD_${ind.id}`] = macd.macd.length > 1 ? macd.macd[macd.macd.length - 2] : null;
        } else if (ind.type === 'BollingerBands') {
            const bb = calculateBollingerBands(closes, ind.params.period, ind.params.stdDev);
            indicatorValues[`BB_upper_${ind.id}`] = bb.upper.length > 0 ? bb.upper[bb.upper.length - 1] : null;
            indicatorValues[`BB_middle_${ind.id}`] = bb.middle.length > 0 ? bb.middle[bb.middle.length - 1] : null;
            indicatorValues[`BB_lower_${ind.id}`] = bb.lower.length > 0 ? bb.lower[bb.lower.length - 1] : null;
            indicatorPrevValues[`BB_upper_${ind.id}`] = bb.upper.length > 1 ? bb.upper[bb.upper.length - 2] : null;
            indicatorPrevValues[`BB_middle_${ind.id}`] = bb.middle.length > 1 ? bb.middle[bb.middle.length - 2] : null;
            indicatorPrevValues[`BB_lower_${ind.id}`] = bb.lower.length > 1 ? bb.lower[bb.lower.length - 2] : null;
        } else if (ind.type === 'VOLUME') {
            indicatorValues[`VOLUME_${ind.id}`] = candles.length > 0 ? candles[candles.length - 1].volume : null;
            indicatorPrevValues[`VOLUME_${ind.id}`] = candles.length > 1 ? candles[candles.length - 2].volume : null;
            if (ind.params && ind.params.lookback) {
                const vols = candles.slice(-ind.params.lookback).map(c => c.volume);
                indicatorValues[`VOLUME_AVG_${ind.id}`] = vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
                const prevVols = candles.slice(-ind.params.lookback - 1, -1).map(c => c.volume);
                indicatorPrevValues[`VOLUME_AVG_${ind.id}`] = prevVols.length > 0 ? prevVols.reduce((a, b) => a + b, 0) / prevVols.length : null;
            }
        } else if (ind.type === 'ATR') {
            const atrArr = calculateATR(candles, ind.params.period);
            indicatorValues[`ATR_${ind.id}`] = atrArr.length > 0 ? atrArr[atrArr.length - 1] : null;
            indicatorPrevValues[`ATR_${ind.id}`] = atrArr.length > 1 ? atrArr[atrArr.length - 2] : null;
        }
    }
    // 2. Evaluate rules (support crosses, near, and previous values)
    for (const rule of config.rules) {
        let cond = rule.condition;
        // Replace indicator references in the condition string
        for (const ind of config.indicators) {
            const key = `${ind.type}_${ind.id}`;
            cond = cond.replaceAll(`${key}_prev`, indicatorPrevValues[key]);
            cond = cond.replaceAll(key, indicatorValues[key]);
        }
        // Also support BB_upper, BB_middle, BB_lower
        for (const ind of config.indicators.filter(i => i.type === 'BollingerBands')) {
            cond = cond.replaceAll(`BB_upper_${ind.id}_prev`, indicatorPrevValues[`BB_upper_${ind.id}`]);
            cond = cond.replaceAll(`BB_middle_${ind.id}_prev`, indicatorPrevValues[`BB_middle_${ind.id}`]);
            cond = cond.replaceAll(`BB_lower_${ind.id}_prev`, indicatorPrevValues[`BB_lower_${ind.id}`]);
            cond = cond.replaceAll(`BB_upper_${ind.id}`, indicatorValues[`BB_upper_${ind.id}`]);
            cond = cond.replaceAll(`BB_middle_${ind.id}`, indicatorValues[`BB_middle_${ind.id}`]);
            cond = cond.replaceAll(`BB_lower_${ind.id}`, indicatorValues[`BB_lower_${ind.id}`]);
        }
        // --- Crossover logic ---
        // e.g. "EMA_5 crossesAbove EMA_20" => (EMA_5_prev < EMA_20_prev && EMA_5 > EMA_20)
        cond = cond.replace(/(\w+)_([\w\d]+) crossesAbove (\w+)_([\w\d]+)/g, '($1_$2_prev < $3_$4_prev && $1_$2 > $3_$4)');
        cond = cond.replace(/(\w+)_([\w\d]+) crossesBelow (\w+)_([\w\d]+)/g, '($1_$2_prev > $3_$4_prev && $1_$2 < $3_$4)');
        // --- Near logic ---
        // e.g. "price near BB_lower_1" => (Math.abs(price - BB_lower_1) < 0.002 * price)
        cond = cond.replace(/price near (BB_(upper|lower|middle)_\w+)/g, '(Math.abs(price - $1) < 0.002 * price)');
        // Add price variable
        const price = candles.length > 0 ? candles[candles.length - 1].close : 0;
        // Evaluate the condition (safe eval)
        try {
            // Only allow numbers, operators, Math.abs, and parentheses
            if (/^[0-9.\s><=+\-*/()&|!Mathabsprice]+$/.test(cond.replace(/Math\.abs/g, '').replace(/price/g, ''))) {
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

export function runConfigStrategyBacktest(
    candles: Candle[],
    config: { indicators: any[]; rules: any[]; risk: any },
    params: { 
        quantity: number; 
        initialBalance: number; 
        marketType?: string; 
        leverage?: number; 
        positionSide?: string;
        // Enhanced features
        volatilityConfig?: VolatilityConfig;
        drawdownConfig?: DrawdownConfig;
        confirmationSignals?: {
            useRSI: boolean;
            rsiPeriod: number;
            rsiOverbought: number;
            rsiOversold: number;
            useVolume: boolean;
            volumeThreshold: number;
            useTrendStrength: boolean;
            minTrendStrength: number;
        };
    }
): BacktestResult {
    const { 
        quantity, 
        initialBalance, 
        marketType = 'spot', 
        leverage = 1, 
        positionSide = 'both',
        // Enhanced features
        volatilityConfig,
        drawdownConfig,
        confirmationSignals,
    } = params;
    
    let balance = initialBalance;
    let position = 0;
    let entryPrice = 0;
    let lastSignal: 'buy' | 'sell' | null = null;
    const trades: TradeLog[] = [];

    // Enhanced features state
    let drawdownState: DrawdownState = {
        peakBalance: initialBalance,
        currentDrawdown: 0,
        maxDrawdownReached: 0,
        lastPeakTime: Date.now(),
    };
    let volatilityRegime: 'low' | 'normal' | 'high' = 'normal';
    let lastVolatilityCheck = 0;

    const roundTo8 = (num: number): number => Math.round(num * 100000000) / 100000000;
    const tpPct = config.risk?.takeProfit ? config.risk.takeProfit / 100 : 0.005; // default 0.5%
    const slPct = config.risk?.stopLoss ? config.risk.stopLoss / 100 : 0.003; // default 0.3%

    for (let i = 0; i < candles.length; i++) {
        const currentTime = candles[i].time;
        
        // Check drawdown protection
        if (drawdownConfig?.enabled) {
            const drawdownResult = updateDrawdownState(drawdownState, balance, drawdownConfig);
            if (drawdownResult.shouldStop) {
                // Stop trading due to drawdown limit
                break;
            }
            drawdownState = {
                ...drawdownState,
                currentDrawdown: calculateDrawdown(balance, drawdownState.peakBalance),
            };
        }

        // Check volatility regime every 5 minutes (300000ms)
        if (volatilityConfig?.enabled && currentTime - lastVolatilityCheck > 300000) {
            const availableCandles = candles.slice(0, i + 1);
            if (availableCandles.length >= volatilityConfig.atrPeriod) {
                volatilityRegime = detectVolatilityRegime(availableCandles, volatilityConfig);
            }
            lastVolatilityCheck = currentTime;
        }

        // Get volatility-adjusted parameters
        let adjustedQuantity = quantity;
        if (volatilityConfig?.enabled) {
            const adjustedParams = getVolatilityAdjustedParams(
                { quantity },
                volatilityRegime,
                volatilityConfig
            );
            adjustedQuantity = adjustedParams.quantity;
        }

        const slicedCandles = candles.slice(0, i + 1);
        const state = { lastSignal, position, entryPrice };
        let signal = interpretConfigStrategy(slicedCandles, state, config);
        const price = candles[i].close;

        // Apply confirmation signals if enabled
        if (signal && confirmationSignals) {
            const conf = confirmationSignals;
            
            // RSI confirmation
            if (conf.useRSI) {
                const rsiValues = calculateRSI(candles.map(c => c.close), conf.rsiPeriod);
                if (rsiValues.length > i) {
                    const currentRSI = rsiValues[i];
                    if (signal === 'buy' && currentRSI > conf.rsiOverbought) {
                        signal = null; // Avoid buying in overbought conditions
                    } else if (signal === 'sell' && currentRSI < conf.rsiOversold) {
                        signal = null; // Avoid selling in oversold conditions
                    }
                }
            }
            
            // Volume confirmation
            if (signal && conf.useVolume) {
                const volumes = candles.map(c => c.volume);
                const avgVolume = volumes.slice(Math.max(0, i - 20), i + 1).reduce((a, b) => a + b, 0) / Math.min(21, i + 1);
                const currentVolume = candles[i].volume;
                if (currentVolume < avgVolume * conf.volumeThreshold) {
                    signal = null; // Insufficient volume
                }
            }
            
            // Trend strength confirmation (using price momentum)
            if (signal && conf.useTrendStrength) {
                const lookback = Math.min(20, i);
                if (lookback > 0) {
                    const recentPrices = candles.slice(i - lookback, i + 1).map(c => c.close);
                    const priceChange = (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0] * 100;
                    if (Math.abs(priceChange) < conf.minTrendStrength) {
                        signal = null; // Trend too weak
                    }
                }
            }
        }

        // Position side filtering
        if (positionSide === 'long' && signal === 'sell') signal = null;
        if (positionSide === 'short' && signal === 'buy') signal = null;

        // --- TP/SL logic ---
        if (position !== 0 && entryPrice > 0) {
            const tp = position > 0 ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct);
            const sl = position > 0 ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);
            if ((position > 0 && (price >= tp || price <= sl)) ||
                (position < 0 && (price <= tp || price >= sl))) {
                // Close position for TP/SL
                if (marketType === 'futures') {
                    const pnl = (position > 0 ? price - entryPrice : entryPrice - price) * Math.abs(position) * leverage;
                    balance = roundTo8(balance + pnl);
                } else {
                    balance = roundTo8(balance + (position > 0 ? price * Math.abs(position) : -price * Math.abs(position)));
                }
                trades.push({ time: candles[i].time, price, side: position > 0 ? 'sell' : 'buy', quantity: Math.abs(position), balance });
                position = 0;
                entryPrice = 0;
                lastSignal = position > 0 ? 'sell' : 'buy';
                continue;
            }
        }

        // --- Signal logic ---
        if (marketType === 'futures') {
            if (signal === 'buy' && position <= 0) {
                // Close short if needed
                if (position < 0) {
                    const pnl = (entryPrice - price) * Math.abs(position) * leverage;
                    balance = roundTo8(balance + pnl);
                    trades.push({ time: candles[i].time, price, side: 'buy', quantity: Math.abs(position), balance });
                }
                // Open long
                position = adjustedQuantity;
                entryPrice = price;
                trades.push({ time: candles[i].time, price, side: 'buy', quantity: adjustedQuantity, balance });
                lastSignal = 'buy';
            } else if (signal === 'sell' && position >= 0) {
                // Close long if needed
                if (position > 0) {
                    const pnl = (price - entryPrice) * position * leverage;
                    balance = roundTo8(balance + pnl);
                    trades.push({ time: candles[i].time, price, side: 'sell', quantity: position, balance });
                }
                // Open short
                position = -adjustedQuantity;
                entryPrice = price;
                trades.push({ time: candles[i].time, price, side: 'sell', quantity: adjustedQuantity, balance });
                lastSignal = 'sell';
            }
        } else {
            // Spot logic
            if (signal === 'buy' && lastSignal !== 'buy' && position === 0 && balance >= price * adjustedQuantity) {
                balance = roundTo8(balance - price * adjustedQuantity);
                position += adjustedQuantity;
                trades.push({ time: candles[i].time, price, side: 'buy', quantity: adjustedQuantity, balance });
                lastSignal = 'buy';
            } else if (signal === 'sell' && lastSignal !== 'sell' && position > 0) {
                balance = roundTo8(balance + price * adjustedQuantity);
                position -= adjustedQuantity;
                trades.push({ time: candles[i].time, price, side: 'sell', quantity: adjustedQuantity, balance });
                lastSignal = 'sell';
            }
        }

        // Update drawdown state
        if (balance > drawdownState.peakBalance) {
            drawdownState.peakBalance = balance;
            drawdownState.lastPeakTime = currentTime;
        }
    }

    // Close any open position at the end
    if (position !== 0) {
        const price = candles[candles.length - 1].close;
        if (marketType === 'futures') {
            const pnl = (position > 0 ? price - entryPrice : entryPrice - price) * Math.abs(position) * leverage;
            balance = roundTo8(balance + pnl);
        } else {
            balance = roundTo8(balance + (position > 0 ? price * Math.abs(position) : -price * Math.abs(position)));
        }
        trades.push({ time: candles[candles.length - 1].time, price, side: position > 0 ? 'sell' : 'buy', quantity: Math.abs(position), balance });
        position = 0;
    }

    // Calculate PnL and win rate
    let pnl = roundTo8(balance - initialBalance);
    let wins = 0, total = 0;
    for (let i = 1; i < trades.length; i += 2) {
        if (trades[i].side === 'sell' && trades[i - 1].side === 'buy') {
            if (trades[i].price > trades[i - 1].price) wins++;
            total++;
        } else if (trades[i].side === 'buy' && trades[i - 1].side === 'sell') {
            if (trades[i].price < trades[i - 1].price) wins++;
            total++;
        }
    }
    const winRate = total > 0 ? wins / total : 0;
    return { trades, pnl, winRate, finalBalance: balance };
} 

/**
 * Volatility-based strategy switching
 * Detects market volatility and adjusts strategy parameters
 */
export interface VolatilityConfig {
    enabled: boolean;
    atrPeriod: number;
    lowVolatilityThreshold: number;
    highVolatilityThreshold: number;
    lowVolStrategy: {
        shortPeriod: number;
        longPeriod: number;
        quantity: number;
    };
    highVolStrategy: {
        shortPeriod: number;
        longPeriod: number;
        quantity: number;
    };
    normalStrategy: {
        shortPeriod: number;
        longPeriod: number;
        quantity: number;
    };
}

export function detectVolatilityRegime(candles: Candle[], config: VolatilityConfig): 'low' | 'normal' | 'high' {
    if (!config.enabled) return 'normal';
    
    const atrValues = calculateATR(candles, config.atrPeriod);
    if (atrValues.length === 0) return 'normal';
    
    const currentATR = atrValues[atrValues.length - 1];
    const avgATR = atrValues.slice(-20).reduce((sum, val) => sum + val, 0) / Math.min(20, atrValues.length);
    const volatilityRatio = currentATR / avgATR;
    
    if (volatilityRatio < config.lowVolatilityThreshold) {
        return 'low';
    } else if (volatilityRatio > config.highVolatilityThreshold) {
        return 'high';
    } else {
        return 'normal';
    }
}

export function getVolatilityAdjustedParams(
    baseParams: any,
    volatilityRegime: 'low' | 'normal' | 'high',
    config: VolatilityConfig
): any {
    if (!config.enabled) return baseParams;
    
    switch (volatilityRegime) {
        case 'low':
            return {
                ...baseParams,
                shortPeriod: config.lowVolStrategy.shortPeriod,
                longPeriod: config.lowVolStrategy.longPeriod,
                quantity: config.lowVolStrategy.quantity
            };
        case 'high':
            return {
                ...baseParams,
                shortPeriod: config.highVolStrategy.shortPeriod,
                longPeriod: config.highVolStrategy.longPeriod,
                quantity: config.highVolStrategy.quantity
            };
        default:
            return {
                ...baseParams,
                shortPeriod: config.normalStrategy.shortPeriod,
                longPeriod: config.normalStrategy.longPeriod,
                quantity: config.normalStrategy.quantity
            };
    }
} 

/**
 * Drawdown tracking and stop logic
 */
export interface DrawdownConfig {
    enabled: boolean;
    maxDrawdown: number; // percentage
    trailingStop: boolean;
    trailingStopDistance: number; // percentage
}

export interface DrawdownState {
    peakBalance: number;
    currentDrawdown: number;
    maxDrawdownReached: number;
    lastPeakTime: number;
}

export function calculateDrawdown(currentBalance: number, peakBalance: number): number {
    if (peakBalance <= 0) return 0;
    return ((peakBalance - currentBalance) / peakBalance) * 100;
}

export function updateDrawdownState(
    state: DrawdownState,
    currentBalance: number,
    config: DrawdownConfig
): { shouldStop: boolean; reason?: string } {
    if (!config.enabled) return { shouldStop: false };
    
    // Update peak balance if we have a new high
    if (currentBalance > state.peakBalance) {
        state.peakBalance = currentBalance;
        state.lastPeakTime = Date.now();
    }
    
    // Calculate current drawdown
    state.currentDrawdown = calculateDrawdown(currentBalance, state.peakBalance);
    
    // Update max drawdown reached
    if (state.currentDrawdown > state.maxDrawdownReached) {
        state.maxDrawdownReached = state.currentDrawdown;
    }
    
    // Check if we should stop trading
    if (state.currentDrawdown >= config.maxDrawdown) {
        return { 
            shouldStop: true, 
            reason: `Maximum drawdown exceeded: ${state.currentDrawdown.toFixed(2)}%` 
        };
    }
    
    // Trailing stop logic
    if (config.trailingStop && state.currentDrawdown > config.trailingStopDistance) {
        const timeSincePeak = Date.now() - state.lastPeakTime;
        const hoursSincePeak = timeSincePeak / (1000 * 60 * 60);
        
        // If we've been in drawdown for more than 24 hours, stop
        if (hoursSincePeak > 24) {
            return { 
                shouldStop: true, 
                reason: `Trailing stop triggered: ${hoursSincePeak.toFixed(1)} hours in drawdown` 
            };
        }
    }
    
    return { shouldStop: false };
} 