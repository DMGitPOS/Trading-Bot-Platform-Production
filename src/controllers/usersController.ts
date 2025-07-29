import { Request, Response } from "express";
import Joi from 'joi';
import User from "../models/User";

export const listUsers = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;
        const total = await User.countDocuments();
        const users = await User.find()
            .select('-password')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        res.json({
            users,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Fetch users failed' });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    const schema = Joi.object({
        name: Joi.string().min(2).max(100).optional(),
        email: Joi.string().email().optional(),
        role: Joi.string().valid('user', 'admin').optional(),
        subscriptionPlan: Joi.string().valid('Free', 'Basic', 'Premium', 'Unknown').optional(),
    });
    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    
    try {
        const userId = req.params.id;
        const { name, email, role, subscriptionPlan } = req.body;
        const update: any = {};
        if (name) update.name = name;
        if (email) update.email = email;
        if (role) {
            const user = await User.findById(userId);
            if (!user) return res.status(404).json({ error: 'User not found' });
            if (user.role === 'admin' && role !== 'admin') {
                const adminCount = await User.countDocuments({ role: 'admin' });
                if (adminCount <= 1) {
                    return res.status(400).json({ error: 'Cannot change role of the last admin user.' });
                }
            }
            update.role = role;
        }
        if (subscriptionPlan !== undefined) {
            if (subscriptionPlan === 'Free') {
                update.subscriptionStatus = 'inactive';
                update.subscriptionPlan = 'Free';
                update.manualSubscription = false;
            } else if (subscriptionPlan === 'Basic' || subscriptionPlan === 'Premium') {
                update.subscriptionStatus = 'active';
                update.subscriptionPlan = subscriptionPlan;
                update.manualSubscription = true;
            } else {
                return res.status(400).json({ error: 'Invalid subscription plan' });
            }
        }
        const user = await User.findByIdAndUpdate(userId, update, { new: true }).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Update user failed' });
    }
};

export const deleteUser = async (req: Request, res: Response) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.role === 'admin') {
            const adminCount = await User.countDocuments({ role: 'admin' });
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot delete the last admin user.' });
            }
        }
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Delete user failed' });
    }
};
