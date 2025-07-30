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
        manualSubscription: Joi.object({
            price: Joi.number().optional(),
            activeBots: Joi.number().optional(),
            expiresAt: Joi.date().optional()
        }).optional()
    });
    const { error } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    
    try {
        const userId = req.params.id;
        const { name, email, role, manualSubscription } = req.body;
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
        if (manualSubscription) {
            update.manualSubscription = {
                active: true,
                price: manualSubscription.price,
                activeBots: manualSubscription.activeBots,
                expiresAt: manualSubscription.expiresAt
            };
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

export const addSubscription = async (req: Request, res: Response) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.manualSubscription.active) return res.status(400).json({ error: 'User already has a subscription' });
        user.manualSubscription.active = true;
        await user.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Add subscription failed' });
    }
};

export const removeSubscription = async (req: Request, res: Response) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.manualSubscription.active) return res.status(400).json({ error: 'User does not have a subscription' });
        user.manualSubscription.active = false;
        user.manualSubscription.expiresAt = null;
        user.manualSubscription.price = 0;
        user.manualSubscription.activeBots = 0;
        await user.save();
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Remove subscription failed' });
    }
};

export const getManualSubscriptionUsers = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;
        const total = await User.countDocuments({ 'manualSubscription.active': true });
        const users = await User.find({ 'manualSubscription.active': true })
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