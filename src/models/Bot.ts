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
}, { timestamps: true });

export default mongoose.model<IBot>('Bot', BotSchema); 