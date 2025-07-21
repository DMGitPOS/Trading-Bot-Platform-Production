import mongoose, { Schema, Document } from "mongoose";

export interface INotificationPreference extends Document {
    user: mongoose.Types.ObjectId;
    email: boolean;
    sms: boolean;
    telegram: boolean;
    discord: boolean;
    smsNumber?: string;
    telegramChatId?: string;
    discordWebhook?: string;
}

const NotificationPreferenceSchema = new Schema<INotificationPreference>({
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
    telegram: { type: Boolean, default: false },
    discord: { type: Boolean, default: false },
    smsNumber: { type: String },
    telegramChatId: { type: String },
    discordWebhook: { type: String },
});

export default mongoose.model<INotificationPreference>(
    "NotificationPreference",
    NotificationPreferenceSchema
); 