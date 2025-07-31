import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export interface IUser extends Document {
    name: string;
    email: string;
    avatar?: string;
    password?: string;
    googleId?: string;
    isEmailVerified: boolean;
    resetPasswordToken?: string;
    resetPasswordExpire?: Date;
    verifyEmailToken?: string;
    verifyEmailExpire?: Date;
    role: 'user' | 'admin';
    twoFAEnabled: boolean;
    twoFASecret?: string;
    twoFAVerified: boolean;
    backupCodes?: string[];
    tempSecret?: string;
    subscriptionStatus?: 'active' | 'inactive' | 'trialing' | 'past_due';
    subscriptionPlan?: 'Free' | 'Basic' | 'Premium';
    subscriptionPrice?: number;
    subscriptionCurrency?: string;
    subscriptionInterval?: string;
    stripeCustomerId?: string;
    referralCode: string;
    referredBy: mongoose.Types.ObjectId | null;
    referrals: mongoose.Types.ObjectId[];
    referralRewards: number;
    manualSubscription: {
        active: boolean;
        expiresAt: string | null;
        price: number;
        activeBots: number;
    };
    comparePassword: (password: string) => Promise<boolean>;
    generateEmailVerificationToken: (email: string) => string;
    createVerificationUrl: (token: string) => string;
    resetPasswordUrl: (token: string) => string;
    createdAt: Date;
    updatedAt: Date;
}

const UserSchema: Schema = new Schema<IUser>({
    name: {
        type: String,
        trim: true,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
    },
    password: {
        type: String,
        required: false,
        select: false,
    },
    avatar: {
        type: String
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    isEmailVerified: {
        type: Boolean,
        default: false,
    },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    verifyEmailToken: String,
    verifyEmailExpire: Date,
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },
    twoFAEnabled: { type: Boolean, default: false },
    twoFASecret: { type: String },
    twoFAVerified: { type: Boolean, default: false },
    backupCodes: [{ type: String }],
    tempSecret: { type: String },
    subscriptionStatus: { type: String, default: 'inactive' },
    subscriptionPlan: { type: String, default: 'Free' },
    subscriptionPrice: { type: Number, default: 0 },
    subscriptionCurrency: { type: String, default: 'USD' },
    subscriptionInterval: { type: String, default: 'month' },
    stripeCustomerId: { type: String },
    referralCode: {
        type: String,
        unique: true,
        required: true,
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    referrals: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: undefined, // Use undefined for arrays in Mongoose
    }],
    referralRewards: {
        type: Number,
        default: 0,
    },
    manualSubscription: {
        active: { type: Boolean, default: false },
        expiresAt: { type: Date, default: null },
        price: { type: Number, default: 0 },
        activeBots: { type: Number, default: 0, min: 0, max: 12 },
    },
}, {
    timestamps: true,
});

// Generate a unique referral code before saving a new user
UserSchema.pre<IUser>('validate', async function (next) {
    if (!this.referralCode) {
        let code;
        let exists: boolean = true;
        while (exists) {
            code = Math.random().toString(36).substring(2, 8).toUpperCase();
            const isExists = await mongoose.models.User.findOne({ referralCode: code });
            exists = !!isExists;
        }
        this.referralCode = code as string;
    }
    next();
});

UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
    if (!this.password) return false;
    return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.generateEmailVerificationToken = function (email: string): string {
    return jwt.sign(
        { email },
        process.env.JWT_SECRET_KEY || 'default_jwt_secret',
        { expiresIn: '1h' }
    );
};

UserSchema.methods.createVerificationUrl = function (token: string): string {
    this.verifyEmailExpire = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    this.verifyEmailToken = token;
    return `${process.env.FRONTEND_BASE_URL}/verify-email?token=${token}`;
};

UserSchema.methods.resetPasswordUrl = function (token: string): string {
    this.resetPasswordExpire = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    this.resetPasswordToken = token;
    return `${process.env.FRONTEND_BASE_URL}/reset-password?token=${token}`;
};

export default mongoose.model<IUser>('User', UserSchema); 