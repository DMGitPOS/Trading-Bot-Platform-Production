import mongoose, { Document, Schema } from 'mongoose';
import { encrypt, decrypt } from '../utils/crypto';

export interface IApiKey extends Document {
    user: mongoose.Schema.Types.ObjectId;
    exchange: string;
    apiKey: string;
    apiSecret: string;
    createdAt: Date;
}

const ApiKeySchema: Schema = new Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    exchange: {
        type: String,
        required: true,
        trim: true,
    },
    apiKey: {
        type: String,
        required: true,
    },
    apiSecret: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

ApiKeySchema.pre<IApiKey>('save', function (this: IApiKey, next) {
    const doc = this as mongoose.Document;
    if (doc.isModified('apiKey')) {
        this.apiKey = encrypt(this.apiKey);
    }
    if (doc.isModified('apiSecret')) {
        this.apiSecret = encrypt(this.apiSecret);
    }
    next();
});

const ApiKey = mongoose.model<IApiKey>('ApiKey', ApiKeySchema);

export default ApiKey; 