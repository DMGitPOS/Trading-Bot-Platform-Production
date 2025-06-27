import mongoose, { Document } from 'mongoose';
export interface IBotLog extends Document {
    bot: mongoose.Types.ObjectId;
    timestamp: Date;
    type: string;
    message: string;
    data?: Record<string, unknown>;
}
declare const _default: mongoose.Model<IBotLog, {}, {}, {}, mongoose.Document<unknown, {}, IBotLog, {}> & IBotLog & Required<{
    _id: unknown;
}> & {
    __v: number;
}, any>;
export default _default;
