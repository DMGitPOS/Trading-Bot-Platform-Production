import { Request, Response } from "express";
import paypal from "paypal-rest-sdk";
import Joi from 'joi';
import User from "../models/User";
import { AuthRequest } from "../middleware/auth";

// Configure PayPal SDK
paypal.configure({
    mode: process.env.PAYPAL_MODE || "sandbox", // "sandbox" or "live"
    client_id: process.env.PAYPAL_CLIENT_ID || "",
    client_secret: process.env.PAYPAL_CLIENT_SECRET || "",
});

const planMap: { [key: string]: { name: string; price: string } } = {
    Basic: { name: "Basic Plan", price: "15.00" },
    Premium: { name: "Premium Plan", price: "30.00" },
};

const createPaymentSchema = Joi.object({
    plan: Joi.string().valid('Basic', 'Premium').required(),
});

const executePaymentSchema = Joi.object({
    paymentId: Joi.string().required(),
    PayerID: Joi.string().required(),
    plan: Joi.string().valid('Basic', 'Premium').required(),
});

export const createPayment = async (req: Request, res: Response) => {
    try {
        const { error } = createPaymentSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { plan } = req.body;
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        if (!planMap[plan]) return res.status(400).json({ error: "Invalid plan" });

        const { name, price } = planMap[plan];

        const payment = {
            intent: "sale",
            payer: { payment_method: "paypal" },
            redirect_urls: {
                return_url: `${process.env.FRONTEND_BASE_URL}/subscription?paypal=success`,
                cancel_url: `${process.env.FRONTEND_BASE_URL}/subscription?paypal=cancel`,
            },
            transactions: [
                {
                    item_list: {
                        items: [
                            {
                                name,
                                sku: plan,
                                price,
                                currency: "USD",
                                quantity: 1,
                            },
                        ],
                    },
                    amount: {
                        currency: "USD",
                        total: price,
                    },
                    description: `Subscription payment for ${name}`,
                },
            ],
        };

        paypal.payment.create(payment, async (error: any, payment: any) => {
            if (error) {
                res.status(500).json({ error: "PayPal payment creation failed" });
            } else {
                // Find approval URL to redirect user
                const approvalUrl = payment.links?.find((l: any) => l.rel === "approval_url")?.href;
                if (approvalUrl) {
                    res.status(201).json({ url: approvalUrl });
                } else {
                    res.status(500).json({ error: "No approval URL found" });
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Create payment failed' });
    }
};

export const executePayment = async (req: Request, res: Response) => {
    try {
        const { error } = executePaymentSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { paymentId, PayerID, plan } = req.body;

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        if (!planMap[plan]) return res.status(400).json({ error: "Invalid plan" });

        const { price } = planMap[plan];

        const execute_payment_json = {
            payer_id: PayerID,
            transactions: [
            {
                amount: {
                    currency: "USD",
                    total: price,
                },
            },
            ],
        };

        paypal.payment.execute(paymentId, execute_payment_json, async (error: any, payment: any) => {
            if (error) {
                res.status(500).json({ error: "PayPal payment execution failed" });
            } else {
                // Mark user as subscribed to the plan
                await User.findByIdAndUpdate(userId, {
                    subscriptionStatus: "active",
                    subscriptionPlan: plan.charAt(0).toUpperCase() + plan.slice(1),
                    manualSubscription: false,
                });
                res.status(201).json({ success: true });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Execute payment failed' });
    }
};
