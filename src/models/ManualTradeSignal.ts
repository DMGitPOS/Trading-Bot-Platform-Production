import mongoose, { Schema, Document } from 'mongoose';

export interface IManualTradeSignal extends Document {
    user: mongoose.Types.ObjectId;
    bot: mongoose.Types.ObjectId;
    signal: 'buy' | 'sell';
    symbol: string;
    price: number;
    quantity: number;
    marketType: 'spot' | 'futures';
    leverage: number;
    positionSide: 'both' | 'long' | 'short';
    status: 'pending' | 'approved' | 'rejected' | 'executed';
    createdAt: Date;
    updatedAt: Date;
}

const ManualTradeSignalSchema = new Schema<IManualTradeSignal>({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bot: { type: Schema.Types.ObjectId, ref: 'Bot', required: true },
    signal: { type: String, enum: ['buy', 'sell'], required: true },
    symbol: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    marketType: { type: String, enum: ['spot', 'futures'], required: true },
    leverage: { type: Number, required: true },
    positionSide: { type: String, enum: ['both', 'long', 'short'], required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'executed'], default: 'pending' },
}, { timestamps: true });

export default mongoose.model<IManualTradeSignal>('ManualTradeSignal', ManualTradeSignalSchema); 