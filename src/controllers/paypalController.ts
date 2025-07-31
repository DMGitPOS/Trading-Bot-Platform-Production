import { Request, Response } from "express";
import paypal from "paypal-rest-sdk";
import Joi from 'joi';
import User from "../models/User";
import Subscription from "../models/Subscription";
import { AuthRequest } from "../middleware/auth";

// Configure PayPal SDK
paypal.configure({
    mode: process.env.PAYPAL_MODE || "sandbox", // "sandbox" or "live"
    client_id: process.env.PAYPAL_CLIENT_ID || "",
    client_secret: process.env.PAYPAL_CLIENT_SECRET || "",
});

const createPaymentSchema = Joi.object({
    priceAmount: Joi.number().positive().required(),
    currency: Joi.string().default('USD'),
    interval: Joi.string().valid('month', 'year').default('month'),
});

const executePaymentSchema = Joi.object({
    paymentId: Joi.string().required(),
    PayerID: Joi.string().required(),
    priceAmount: Joi.number().positive().required(),
    currency: Joi.string().default('USD'),
    interval: Joi.string().valid('month', 'year').default('month'),
});

export const createPayment = async (req: Request, res: Response) => {
    try {
        const { error } = createPaymentSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { priceAmount, currency = 'USD', interval = 'month' } = req.body;
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const priceString = priceAmount.toFixed(2);
        const planName = `Custom ${interval}ly subscription`;

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
                                name: planName,
                                sku: `custom-${interval}-${priceAmount}`,
                                price: priceString,
                                currency: currency,
                                quantity: 1,
                            },
                        ],
                    },
                    amount: {
                        currency: currency,
                        total: priceString,
                    },
                    description: `Subscription payment for ${planName}`,
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

        const { paymentId, PayerID, priceAmount, currency = 'USD', interval = 'month' } = req.body;

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const priceString = priceAmount.toFixed(2);

        const execute_payment_json = {
            payer_id: PayerID,
            transactions: [
            {
                amount: {
                    currency: currency,
                    total: priceString,
                },
            },
            ],
        };

        paypal.payment.execute(paymentId, execute_payment_json, async (error: any, payment: any) => {
            if (error) {
                res.status(500).json({ error: "PayPal payment execution failed" });
            } else {
                // Mark user as subscribed to the plan
                let subscriptionPlan: 'Free' | 'Basic' | 'Premium' = 'Free';

                const planMap = await Subscription.findOne({ price: priceAmount });
                if (planMap?.plan) {
                    subscriptionPlan = planMap.plan;
                }

                await User.findByIdAndUpdate(userId, {
                    subscriptionStatus: "active",
                    subscriptionPlan: subscriptionPlan,
                    subscriptionPrice: priceAmount,
                });
                res.status(201).json({ success: true });
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Execute payment failed' });
    }
};
