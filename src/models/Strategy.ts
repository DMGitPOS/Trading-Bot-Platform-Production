import mongoose, { Schema, Document } from 'mongoose';

export interface IStrategy extends Document {
    user: mongoose.Types.ObjectId;
    name: string;
    type: string; // e.g. 'custom', 'moving_average', etc.
    code?: string; // for custom code
    config?: Record<string, any>; // for parameter-based strategies
    createdAt: Date;
    updatedAt: Date;
}

const StrategySchema = new Schema<IStrategy>({
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
    code: { type: String },
    config: { type: Schema.Types.Mixed },
}, { timestamps: true });

export default mongoose.model<IStrategy>('Strategy', StrategySchema); 