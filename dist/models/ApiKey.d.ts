import mongoose, { Document } from 'mongoose';
export interface IApiKey extends Document {
    user: mongoose.Schema.Types.ObjectId;
    exchange: string;
    apiKey: string;
    apiSecret: string;
    createdAt: Date;
}
declare const ApiKey: mongoose.Model<IApiKey, {}, {}, {}, mongoose.Document<unknown, {}, IApiKey, {}> & IApiKey & Required<{
    _id: unknown;
}> & {
    __v: number;
}, any>;
export default ApiKey;
