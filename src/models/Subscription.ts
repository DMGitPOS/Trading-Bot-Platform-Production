import mongoose, { Document, Schema } from "mongoose";

export interface ISubscription extends Document {
    plan: 'Basic' | 'Premium';
    price: number;
    currency: 'USD' | 'EUR' | 'GBP';
    interval: 'month' | 'year';
    createdAt: Date;
    updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
    {
        plan: { type: String, enum: ["Basic", "Premium"], required: true },
        price: { type: Number, required: true },
        currency: { type: String, enum: ["USD", "EUR", "GBP"], default: "USD" },
        interval: { type: String, enum: ["month", "year"], default: "month" },
    },
    { timestamps: true }
);

export default mongoose.model<ISubscription>("Subscription", SubscriptionSchema);
