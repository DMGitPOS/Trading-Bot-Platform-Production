import { Request, Response } from 'express';
import Strategy from '../models/Strategy';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth';

const strategySchema = Joi.object({
    name: Joi.string().required(),
    config: Joi.object().optional()
});

const updateStrategySchema = Joi.object({
    name: Joi.string().optional(),
    config: Joi.object().optional()
});

export const createStrategy = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const { error } = strategySchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.message });

        const { name, type, code, config } = req.body;
        const strategy = new Strategy({ user: userId, name, type, code, config });
        await strategy.save();

        res.status(201).json(strategy);
    } catch (error) {
        res.status(500).json({ error: 'Create strategy failed' });
    }
};

export const getStrategies = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const total = await Strategy.countDocuments({ user: userId });
        const strategies = await Strategy.find({ user: userId })
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            strategies,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Fetch strategies failed' });
    }
};

export const getStrategy = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });
        const strategy = await Strategy.findOne({ _id: req.params.id, user: userId });
        if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
        res.status(200).json(strategy);
    } catch (error) {
        res.status(500).json({ error: 'Fetch strategy failed' });
    }
};

export const updateStrategy = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const { error } = updateStrategySchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.message });

        const { name, type, code, config } = req.body;

        const strategy = await Strategy.findOne({ _id: req.params.id, user: userId });
        if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
        
        if (name) strategy.name = name;
        if (config !== undefined) strategy.config = config;
        await strategy.save();
        res.status(200).json(strategy);
    } catch (error) {
        res.status(500).json({ error: 'Update strategy failed' });
    }
};

export const deleteStrategy = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const strategy = await Strategy.findOneAndDelete({ _id: req.params.id, user: userId });
        if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
        
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Delete strategy failed' });
    }
}; 