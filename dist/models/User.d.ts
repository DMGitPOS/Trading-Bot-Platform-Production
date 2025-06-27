import mongoose, { Document } from 'mongoose';
export interface IUser extends Document {
    email: string;
    password?: string;
    name?: string;
    isEmailVerified: boolean;
    emailVerificationToken?: string;
    resetPasswordToken?: string;
    twoFAEnabled: boolean;
    twoFASecret?: string;
    createdAt: Date;
    updatedAt: Date;
    googleId?: string;
    subscriptionStatus?: string;
    subscriptionPlan?: string;
    stripeCustomerId?: string;
}
declare const _default: mongoose.Model<IUser, {}, {}, {}, mongoose.Document<unknown, {}, IUser, {}> & IUser & Required<{
    _id: unknown;
}> & {
    __v: number;
}, any>;
export default _default;
