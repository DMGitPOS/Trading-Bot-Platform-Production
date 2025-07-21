import mongoose, { Document, Schema } from "mongoose";

export interface ISupportTicket extends Document {
    user: mongoose.Types.ObjectId;
    subject: string;
    message: string;
    status: "open" | "closed" | "pending";
    response?: string;
    createdAt: Date;
    updatedAt: Date;
}

const SupportTicketSchema = new Schema<ISupportTicket>(
    {
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        subject: { type: String, required: true },
        message: { type: String, required: true },
        status: { type: String, enum: ["open", "closed", "pending"], default: "open" },
        response: { type: String },
    },
    { timestamps: true }
);

export default mongoose.model<ISupportTicket>("SupportTicket", SupportTicketSchema);
