import mongoose, { Document, Schema } from 'mongoose';

export interface IReferralRewardHistory extends Document {
    user: mongoose.Types.ObjectId; // The user who earned the reward
    referredUser: mongoose.Types.ObjectId; // The user who was referred
    date: Date;
    rewardAmount: number;
    status: 'pending' | 'completed' | 'revoked';
    description: string;
}

const ReferralRewardHistorySchema = new Schema<IReferralRewardHistory>({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, default: Date.now },
    rewardAmount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'completed', 'revoked'], default: 'completed' },
    description: { type: String, default: '' },
});

export default mongoose.model<IReferralRewardHistory>('ReferralRewardHistory', ReferralRewardHistorySchema); 