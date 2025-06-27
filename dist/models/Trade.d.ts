import mongoose, { Document } from 'mongoose';
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
declare const _default: mongoose.Model<ITrade, {}, {}, {}, mongoose.Document<unknown, {}, ITrade, {}> & ITrade & Required<{
    _id: unknown;
}> & {
    __v: number;
}, any>;
export default _default;
