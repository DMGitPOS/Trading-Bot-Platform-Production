import mongoose, { Schema, Document } from "mongoose";

export interface INotification extends Document {
    user: mongoose.Types.ObjectId;
    type: "error" | "alert" | "info" | string;
    message: string;
    botName?: string;
    timestamp: Date;
    read: boolean;
}

const NotificationSchema = new Schema<INotification>({
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    botName: { type: String },
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false },
});

export default mongoose.model<INotification>("Notification", NotificationSchema);