import mongoose, { Document, Schema } from 'mongoose';

export interface ITrade extends Document {
  user: mongoose.Types.ObjectId;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: Date;
  status: 'filled' | 'pending' | 'cancelled' | 'failed';
  exchange: string;
}

const TradeSchema: Schema = new Schema<ITrade>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: { type: String, required: true },
  side: { type: String, enum: ['buy', 'sell'], required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ['filled', 'pending', 'cancelled', 'failed'], default: 'filled' },
  exchange: { type: String, required: true },
});

export default mongoose.model<ITrade>('Trade', TradeSchema); 