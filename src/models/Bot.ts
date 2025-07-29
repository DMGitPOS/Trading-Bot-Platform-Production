import mongoose, { Schema, Document } from 'mongoose';

export interface IBot extends Document {
    user: mongoose.Types.ObjectId;
    name: string;
    exchange: string;
    apiKeyRef: mongoose.Types.ObjectId;
    strategy: Record<string, unknown>;
    status: 'stopped' | 'running' | 'error';
    performance: {
        pnl: number;
        winRate: number;
        tradeCount: number;
        lastTradeAt?: Date;
    };
    // Paper trading configuration
    paperTrading: boolean;
    paperBalance: number;
    riskLimits: {
        maxDailyLoss: number;
        maxPositionSize: number;
        stopLoss: number; // percentage
        takeProfit: number; // percentage
    };
    marketType: 'spot' | 'futures';
    leverage: number;
    positionSide: 'both' | 'long' | 'short';
    useTestnet?: boolean;
    testnetApiKeyRef?: mongoose.Types.ObjectId;
    mode: 'auto' | 'manual';
    // Enhanced features
    volatilityConfig?: {
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
    };
    drawdownConfig?: {
        enabled: boolean;
        maxDrawdown: number; // percentage
        trailingStop: boolean;
        trailingStopDistance: number; // percentage
    };
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
    createdAt: Date;
    updatedAt: Date;
}

const BotSchema = new Schema<IBot>({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    exchange: { type: String, required: true },
    apiKeyRef: { type: Schema.Types.ObjectId, ref: 'ApiKey', required: true },
    strategy: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['stopped', 'running', 'error'], default: 'stopped' },
    performance: {
        pnl: { type: Number, default: 0 },
        winRate: { type: Number, default: 0 },
        tradeCount: { type: Number, default: 0 },
        lastTradeAt: { type: Date },
    },
    // Paper trading configuration
    paperTrading: { type: Boolean, default: true }, // Default to paper trading for safety
    paperBalance: { type: Number, default: 10000 }, // Default $10,000 paper balance
    riskLimits: {
        maxDailyLoss: { type: Number, default: 500 }, // $500 daily loss limit
        maxPositionSize: { type: Number, default: 1000 }, // $1000 max position
        stopLoss: { type: Number, default: 5 }, // 5% stop loss
        takeProfit: { type: Number, default: 10 }, // 10% take profit
    },
    marketType: { type: String, enum: ['spot', 'futures'], default: 'spot', required: true },
    leverage: { type: Number, default: 1, required: true },
    positionSide: { type: String, enum: ['both', 'long', 'short'], default: 'both', required: true },
    useTestnet: { type: Boolean, default: false },
    testnetApiKeyRef: { type: Schema.Types.ObjectId, ref: 'ApiKey' },
    mode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    // Enhanced features
    volatilityConfig: {
        enabled: { type: Boolean, default: false },
        atrPeriod: { type: Number, default: 14 },
        lowVolatilityThreshold: { type: Number, default: 0.5 }, // 0.5%
        highVolatilityThreshold: { type: Number, default: 2.0 }, // 2.0%
        lowVolStrategy: {
            shortPeriod: { type: Number, default: 5 },
            longPeriod: { type: Number, default: 20 },
            quantity: { type: Number, default: 1 },
        },
        highVolStrategy: {
            shortPeriod: { type: Number, default: 5 },
            longPeriod: { type: Number, default: 20 },
            quantity: { type: Number, default: 1 },
        },
        normalStrategy: {
            shortPeriod: { type: Number, default: 5 },
            longPeriod: { type: Number, default: 20 },
            quantity: { type: Number, default: 1 },
        },
    },
    drawdownConfig: {
        enabled: { type: Boolean, default: false },
        maxDrawdown: { type: Number, default: 10 }, // 10%
        trailingStop: { type: Boolean, default: false },
        trailingStopDistance: { type: Number, default: 5 }, // 5%
    },
    confirmationSignals: {
        useRSI: { type: Boolean, default: false },
        rsiPeriod: { type: Number, default: 14 },
        rsiOverbought: { type: Number, default: 70 },
        rsiOversold: { type: Number, default: 30 },
        useVolume: { type: Boolean, default: false },
        volumeThreshold: { type: Number, default: 1000 }, // 1000+
        useTrendStrength: { type: Boolean, default: false },
        minTrendStrength: { type: Number, default: 0.5 }, // 0.5+
    },
}, { timestamps: true });

export default mongoose.model<IBot>('Bot', BotSchema); 