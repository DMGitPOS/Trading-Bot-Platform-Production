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
}, { timestamps: true });

export default mongoose.model<IBot>('Bot', BotSchema); 