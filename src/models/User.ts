import mongoose, { Document, Schema } from 'mongoose';

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

const UserSchema: Schema = new Schema<IUser>({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: false },
  name: { type: String },
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String },
  resetPasswordToken: { type: String },
  twoFAEnabled: { type: Boolean, default: false },
  twoFASecret: { type: String },
  googleId: { type: String },
  subscriptionStatus: { type: String, default: 'inactive' },
  subscriptionPlan: { type: String, default: 'Free' },
  stripeCustomerId: { type: String },
}, {
  timestamps: true,
});

export default mongoose.model<IUser>('User', UserSchema); 