import { Request, Response } from 'express';
import Stripe from 'stripe';
import User from '../models/User';
import { AuthRequest } from "../middleware/auth";
import Joi from 'joi';
import ReferralRewardHistory from '../models/ReferralRewardHistory';
import { notifyUser } from '../services/notification/notifyUser';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;

const createCheckoutSessionSchema = Joi.object({
    priceId: Joi.string().required(),
});

export const createCheckoutSession = async (req: Request, res: Response) => {
    try {
        const { error } = createCheckoutSessionSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { priceId } = req.body;
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        let stripeCustomerId = user.stripeCustomerId;
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                name: user.name,
                metadata: { userId: user.id.toString() },
            });

            stripeCustomerId = customer.id;
            await User.findByIdAndUpdate(user.id, { stripeCustomerId });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            customer: stripeCustomerId,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: `${process.env.FRONTEND}/subscription?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND}/subscription?canceled=1`,
        });

        res.status(201).json({ url: session.url });
    } catch (error) {
        res.status(500).json({ error: 'Create checkout session failed' });
    }
};

export const handleWebhook = async (req: Request, res: Response) => {
    try {
        const sig = req.headers['stripe-signature'] as string | undefined;
        if (!sig) return res.status(400).json({ message: 'No Stripe signature found' });

        const event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            STRIPE_WEBHOOK_SECRET
        );

        switch (event.type) {
            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const subscription = event.data.object as Stripe.Subscription;
                const { customer, status, items } = subscription;
                const priceId = items.data[0].price.id;
                const planMap: { [key: string]: string } = {
                    [process.env.STRIPE_BASIC_PRICE_ID as string]: 'Basic',
                    [process.env.STRIPE_PREMIUM_PRICE_ID as string]: 'Premium',
                };
                const updatedUser = await User.findOneAndUpdate(
                    { stripeCustomerId: customer },
                    {
                        subscriptionStatus: status === 'active' || status === 'trialing' ? 'active' : status,
                        subscriptionPlan: planMap[priceId] || 'Unknown',
                    },
                    { new: true }
                );
                if (!updatedUser) {
                    console.error(`No user found for Stripe customer: ${customer}`);
                } else {
                    console.log(`Updated subscription for user ${updatedUser.email} to ${status} - ${planMap[priceId]}`);
                    if (updatedUser.referredBy) {
                        const pendingReward = await ReferralRewardHistory.findOne({
                            user: updatedUser.referredBy,
                            referredUser: updatedUser._id,
                            status: 'pending',
                        });
                        if (pendingReward) {
                            pendingReward.status = 'completed';
                            await pendingReward.save();
                            await User.findByIdAndUpdate(updatedUser.referredBy, { $inc: { referralRewards: 1 } });
                            const referrer = await User.findById(updatedUser.referredBy);
                            if (referrer && referrer.email) {
                                await notifyUser({
                                    userId: String(referrer._id),
                                    type: 'referral',
                                    message: `Congratulations! You earned a reward for referring ${updatedUser.email} (after they subscribed).`,
                                });
                            }
                        }
                    }
                }
                break;
            }
            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                const updatedUser = await User.findOneAndUpdate(
                    { stripeCustomerId: subscription.customer },
                    {
                        subscriptionStatus: 'inactive',
                        subscriptionPlan: 'Free',
                    },
                    { new: true }
                );
                if (!updatedUser) {
                    console.error(`No user found for Stripe customer: ${subscription.customer}`);
                } else {
                    console.log(`Subscription cancelled for user ${updatedUser.email}`);
                }
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                const updatedUser = await User.findOneAndUpdate(
                    { stripeCustomerId: invoice.customer as string },
                    { subscriptionStatus: 'past_due' },
                    { new: true }
                );
                if (!updatedUser) {
                    console.error(`No user found for Stripe customer: ${invoice.customer}`);
                } else {
                    console.log(`Payment failed for user ${updatedUser.email}`);
                }
                break;
            }
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }
        res.status(201).json({ received: true });
    } catch (err) {
        res.status(500).json({ error: 'Stripe webhook failed' });
    }
};

export const createPortalSession = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const user = await User.findById(userId);
        if (!user || !user.stripeCustomerId) return res.status(401).json({ message: 'Unauthorized or no customer ID found' });

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: user.stripeCustomerId,
            return_url: `${process.env.FRONTEND}/dashboard/subscription?refresh=true`,
        });
        res.status(201).json({ url: portalSession.url });
    } catch (err) {
        res.status(500).json({ error: 'Create portal session failed' });
    }
};

// Admin: Get subscription analytics
export const getSubscriptionAnalytics = async (req: Request, res: Response) => {
    try {
        // Get total users by subscription plan
        const [
            totalUsers,
            activeSubscriptions,
            trialSubscriptions,
            pastDueSubscriptions,
            basicPlanUsers,
            premiumPlanUsers,
            freeUsers
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ subscriptionStatus: 'active' }),
            User.countDocuments({ subscriptionStatus: 'trialing' }),
            User.countDocuments({ subscriptionStatus: 'past_due' }),
            User.countDocuments({ subscriptionPlan: 'Basic', subscriptionStatus: 'active' }),
            User.countDocuments({ subscriptionPlan: 'Premium', subscriptionStatus: 'active' }),
            User.countDocuments({ subscriptionPlan: 'Free' })
        ]);

        // Calculate percentages
        const activeRate = (activeSubscriptions / totalUsers) * 100;
        const conversionRate = ((basicPlanUsers + premiumPlanUsers) / totalUsers) * 100;

        res.json({
            totalUsers,
            subscriptions: {
                active: activeSubscriptions,
                trialing: trialSubscriptions,
                pastDue: pastDueSubscriptions,
                total: activeSubscriptions + trialSubscriptions + pastDueSubscriptions
            },
            plans: {
                basic: basicPlanUsers,
                premium: premiumPlanUsers,
                free: freeUsers
            },
            rates: {
                active: activeRate.toFixed(2),
                conversion: conversionRate.toFixed(2)
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch subscription analytics' });
    }
};

// Admin: Get recent subscriptions
export const getRecentSubscriptions = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const total = await User.countDocuments({ 
            subscriptionStatus: { $in: ['active', 'trialing'] } 
        });

        const recentSubscriptions = await User.find({ 
            subscriptionStatus: { $in: ['active', 'trialing'] } 
        })
        .select('name email subscriptionPlan subscriptionStatus createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

        res.json({
            subscriptions: recentSubscriptions,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch recent subscriptions' });
    }
}; 