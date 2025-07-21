import mongoose, { Schema, Document } from 'mongoose';

export interface IBotLog extends Document {
    bot: mongoose.Types.ObjectId;
    timestamp: Date;
    type: string;
    message: string;
    data?: Record<string, unknown>;
}

const BotLogSchema = new Schema<IBotLog>({
    bot: { type: Schema.Types.ObjectId, ref: 'Bot', required: true },
    timestamp: { type: Date, default: Date.now },
    type: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
});

export default mongoose.model<IBotLog>('BotLog', BotLogSchema); 