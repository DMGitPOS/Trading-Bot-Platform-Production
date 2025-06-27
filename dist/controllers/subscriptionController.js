"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPortalSession = exports.handleWebhook = exports.createCheckoutSession = void 0;
const stripe_1 = __importDefault(require("stripe"));
const User_1 = __importDefault(require("../models/User"));
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const createCheckoutSession = async (req, res) => {
    const { priceId } = req.body;
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    const user = await User_1.default.findById(userId);
    if (!user) {
        res.status(404).json({ message: 'User not found' });
        return;
    }
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
            email: user.email,
            name: user.name,
            metadata: { userId: user.id.toString() },
        });
        stripeCustomerId = customer.id;
        await User_1.default.findByIdAndUpdate(user.id, { stripeCustomerId });
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
        success_url: `${process.env.FRONTEND}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND}/dashboard/subscription?canceled=1`,
    });
    res.json({ url: session.url });
};
exports.createCheckoutSession = createCheckoutSession;
const handleWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
        res.status(400).json({ message: 'No Stripe signature found' });
        return;
    }
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
            const subscription = event.data.object;
            const { customer, status, items } = subscription;
            const priceId = items.data[0].price.id;
            const planMap = {
                [process.env.STRIPE_BASIC_PRICE_ID]: 'Basic',
                [process.env.STRIPE_PREMIUM_PRICE_ID]: 'Premium',
            };
            const updatedUser = await User_1.default.findOneAndUpdate({ stripeCustomerId: customer }, {
                subscriptionStatus: status === 'active' || status === 'trialing' ? 'active' : status,
                subscriptionPlan: planMap[priceId] || 'Unknown',
            }, { new: true });
            if (!updatedUser) {
                console.error(`No user found for Stripe customer: ${customer}`);
            }
            else {
                console.log(`Updated subscription for user ${updatedUser.email} to ${status} - ${planMap[priceId]}`);
            }
            break;
        }
        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            const updatedUser = await User_1.default.findOneAndUpdate({ stripeCustomerId: subscription.customer }, {
                subscriptionStatus: 'inactive',
                subscriptionPlan: 'Free',
            }, { new: true });
            if (!updatedUser) {
                console.error(`No user found for Stripe customer: ${subscription.customer}`);
            }
            else {
                console.log(`Subscription cancelled for user ${updatedUser.email}`);
            }
            break;
        }
        case 'invoice.payment_failed': {
            const invoice = event.data.object;
            const updatedUser = await User_1.default.findOneAndUpdate({ stripeCustomerId: invoice.customer }, { subscriptionStatus: 'past_due' }, { new: true });
            if (!updatedUser) {
                console.error(`No user found for Stripe customer: ${invoice.customer}`);
            }
            else {
                console.log(`Payment failed for user ${updatedUser.email}`);
            }
            break;
        }
        default:
            console.log(`Unhandled event type: ${event.type}`);
    }
    res.json({ received: true });
};
exports.handleWebhook = handleWebhook;
const createPortalSession = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    const user = await User_1.default.findById(userId);
    if (!user || !user.stripeCustomerId) {
        res.status(401).json({ message: 'Unauthorized or no customer ID found' });
        return;
    }
    const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${process.env.FRONTEND}/dashboard/subscription?refresh=true`,
    });
    res.json({ url: portalSession.url });
};
exports.createPortalSession = createPortalSession;
//# sourceMappingURL=subscriptionController.js.map