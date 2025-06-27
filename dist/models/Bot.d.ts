import mongoose, { Document } from 'mongoose';
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
declare const _default: mongoose.Model<IBot, {}, {}, {}, mongoose.Document<unknown, {}, IBot, {}> & IBot & Required<{
    _id: unknown;
}> & {
    __v: number;
}, any>;
export default _default;
