import Joi from 'joi';
import Subscription from '../models/Subscription';
import { Request, Response } from 'express';

const subscriptionSchema = Joi.object({
    plan: Joi.string().valid('Basic', 'Premium').required(),
    price: Joi.number().positive().required(),
    currency: Joi.string().valid('USD', 'EUR', 'GBP').default('USD'),
    interval: Joi.string().valid('month', 'year').default('month'),
});

const updateSubscriptionSchema = Joi.object({
    plan: Joi.string().valid('Basic', 'Premium').optional(),
    price: Joi.number().positive().optional(),
    currency: Joi.string().valid('USD', 'EUR', 'GBP').optional(),
    interval: Joi.string().valid('month', 'year').optional(),
});

// Create a new subscription plan
export const testCreateSubscription = async (req: Request, res: Response) => {
    try {
        const lists = [
            {
                plan: 'Basic',
                price: 10,
            },
            {
                plan: 'Premium',
                price: 20,
            }
        ]

        for (const list of lists) {
            const subscription = new Subscription(list);
            await subscription.save();
        }

        res.status(201).json({ message: 'Subscriptions created successfully' });
    } catch (error) {
        console.error('Create subscription error:', error);
        res.status(500).json({ error: 'Create subscription failed' });
    }
};

// Create a new subscription plan
export const createSubscription = async (req: Request, res: Response) => {
    try {
        const { error } = subscriptionSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { plan, price, currency, interval } = req.body;

        const existingSubscription = await Subscription.findOne({ plan });
        
        if (existingSubscription) {
            return res.status(400).json({ 
                error: `Subscription plan ${plan} already exists` 
            });
        }

        const subscription = new Subscription({
            plan,
            price,
            currency,
            interval
        });

        await subscription.save();
        res.status(201).json(subscription);
    } catch (error) {
        console.error('Create subscription error:', error);
        res.status(500).json({ error: 'Create subscription failed' });
    }
};

// Get all subscription plans with pagination
export const getSubscriptions = async (req: Request, res: Response) => {
    try {
        const subscriptions = await Subscription.find()
            .sort({ plan: 1 });

        res.json(subscriptions);
    } catch (error) {
        console.error('Get subscriptions error:', error);
        res.status(500).json({ error: 'Fetch subscriptions failed' });
    }
};

// Update a subscription plan
export const updateSubscription = async (req: Request, res: Response) => {
    try {
        const { error } = updateSubscriptionSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { plan, price, currency, interval } = req.body;
        const subscriptionId = req.params.id;

        // Check if subscription exists
        const existingSubscription = await Subscription.findById(subscriptionId);
        if (!existingSubscription) {
            return res.status(404).json({ error: 'Subscription not found' });
        }

        // If plan, currency, or interval is being changed, check for conflicts
        if ((plan && plan !== existingSubscription.plan) || 
            (currency && currency !== existingSubscription.currency) || 
            (interval && interval !== existingSubscription.interval)) {
            
            const conflictCheck = await Subscription.findOne({
                _id: { $ne: subscriptionId },
                plan: plan || existingSubscription.plan,
                currency: currency || existingSubscription.currency,
                interval: interval || existingSubscription.interval
            });

            if (conflictCheck) {
                return res.status(400).json({ 
                    error: `Subscription plan ${plan || existingSubscription.plan} already exists` 
                });
            }
        }

        // Update the subscription
        const updateData: any = {};
        if (plan !== undefined) updateData.plan = plan;
        if (price !== undefined) updateData.price = price;
        if (currency !== undefined) updateData.currency = currency;
        if (interval !== undefined) updateData.interval = interval;

        const updatedSubscription = await Subscription.findByIdAndUpdate(
            subscriptionId,
            updateData,
            { new: true }
        );

        res.json(updatedSubscription);
    } catch (error) {
        console.error('Update subscription error:', error);
        res.status(500).json({ error: 'Update subscription failed' });
    }
};