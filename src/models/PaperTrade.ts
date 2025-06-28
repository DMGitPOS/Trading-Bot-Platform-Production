import mongoose, { Schema, Document } from 'mongoose';

export interface IPaperTrade extends Document {
  bot: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: Date;
  status: 'filled' | 'pending' | 'cancelled' | 'failed';
  exchange: string;
  paperBalance: number; // Balance after this trade
  tradeType: 'paper' | 'real';
  pnl?: number; // Profit/Loss for this trade
}

const PaperTradeSchema = new Schema<IPaperTrade>({
  bot: { type: Schema.Types.ObjectId, ref: 'Bot', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: { type: String, required: true },
  side: { type: String, enum: ['buy', 'sell'], required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ['filled', 'pending', 'cancelled', 'failed'], default: 'filled' },
  exchange: { type: String, required: true },
  paperBalance: { type: Number, required: true },
  tradeType: { type: String, enum: ['paper', 'real'], default: 'paper' },
  pnl: { type: Number }, // Profit/Loss for this trade
});

// Index for efficient queries
PaperTradeSchema.index({ bot: 1, timestamp: -1 });
PaperTradeSchema.index({ user: 1, timestamp: -1 });

export default mongoose.model<IPaperTrade>('PaperTrade', PaperTradeSchema); 