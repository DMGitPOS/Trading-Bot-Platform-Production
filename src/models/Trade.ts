import mongoose, { Document, Schema } from 'mongoose';

export interface ITrade extends Document {
    user: mongoose.Types.ObjectId;
    bot?: mongoose.Types.ObjectId; // Optional: for bot-generated trades
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    timestamp: Date;
    status: 'filled' | 'pending' | 'cancelled' | 'failed';
    exchange: string;
    orderId?: string; // Exchange order ID
}

const TradeSchema: Schema = new Schema<ITrade>({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bot: { type: Schema.Types.ObjectId, ref: 'Bot' }, // Optional: for bot-generated trades
    symbol: { type: String, required: true },
    side: { type: String, enum: ['buy', 'sell'], required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
    status: { type: String, enum: ['filled', 'pending', 'cancelled', 'failed'], default: 'filled' },
    exchange: { type: String, required: true },
    orderId: { type: String }, // Exchange order ID
});

export default mongoose.model<ITrade>('Trade', TradeSchema); 