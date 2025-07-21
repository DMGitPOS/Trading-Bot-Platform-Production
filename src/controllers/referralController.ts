import { Request, Response } from 'express';
import Joi from 'joi';
import ReferralRewardHistory from '../models/ReferralRewardHistory';
import { AuthRequest } from '../middleware/auth';
import User from '../models/User';

const creditReferralRewardSchema = Joi.object({
    userId: Joi.string().required(),
    referredUserId: Joi.string().required(),
    rewardAmount: Joi.number().required(),
    description: Joi.string().optional(),
});

export const getReferralRewardHistory = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const history = await ReferralRewardHistory.find({ user: userId })
            .sort({ date: -1 })
            .populate('referredUser', 'name email _id');

        res.status(201).json({ history });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch referral reward history' });
    }
};

export const listAllReferralRewards = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string, 10) || 1;
        const limit = parseInt(req.query.limit as string, 10) || 50;
        const skip = (page - 1) * limit;

        const filter: any = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.startDate || req.query.endDate) {
        filter.date = {};
        if (req.query.startDate) filter.date.$gte = new Date(req.query.startDate as string);
        if (req.query.endDate) filter.date.$lte = new Date(req.query.endDate as string);
        }

        // Search by user email
        if (req.query.userEmail) {
            const user = await User.findOne({ email: req.query.userEmail });
            if (user) filter.user = user._id;
            else filter.user = null; // No results if not found
        }

        // Search by referred user email
        if (req.query.referredEmail) {
            const referred = await User.findOne({ email: req.query.referredEmail });
            if (referred) filter.referredUser = referred._id;
            else filter.referredUser = null;
        }

        const [total, rewards] = await Promise.all([
            ReferralRewardHistory.countDocuments(filter),
            ReferralRewardHistory.find(filter)
                .sort({ date: -1 })
                .skip(skip)
                .limit(limit)
                .populate('user', 'name email _id')
                .populate('referredUser', 'name email _id')
        ]);

        res.status(201).json({
            page,
            total,
            totalPages: Math.ceil(total / limit),
            rewards,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch referral rewards' });
    }
};

export const creditReferralReward = async (req: Request, res: Response) => {
    try {
        const { error } = creditReferralRewardSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });
    
        const { userId, referredUserId, rewardAmount, description } = req.body;
        
        await ReferralRewardHistory.create({
            user: userId,
            referredUser: referredUserId,
            rewardAmount,
            status: 'completed',
            description: description || 'Admin credited reward',
        });

        await User.findByIdAndUpdate(userId, { $inc: { referralRewards: rewardAmount } });
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to credit referral reward' });
    }
};

export const revokeReferralReward = async (req: Request, res: Response) => {
    try {
        const schema = Joi.object({
            rewardId: Joi.string().required(),
        });
        const { error } = schema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });
    
        const { rewardId } = req.body;
        if (!rewardId) return res.status(400).json({ error: 'Missing rewardId' });
        
        const reward = await ReferralRewardHistory.findById(rewardId);
        if (!reward) return res.status(404).json({ error: 'Reward not found' });
        
        if (reward.status === 'revoked') return res.status(400).json({ error: 'Reward already revoked' });
        
        reward.status = 'revoked';

        await reward.save();
        await User.findByIdAndUpdate(reward.user, { $inc: { referralRewards: -reward.rewardAmount } });

        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to revoke referral reward' });
    }
};

export const getTopReferrers = async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string, 10) || 10;
        // Aggregate completed rewards by user
        const top = await ReferralRewardHistory.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: '$user', rewardCount: { $sum: '$rewardAmount' } } },
            { $sort: { rewardCount: -1 } },
            { $limit: limit },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'userInfo',
                },
            },
            { $unwind: '$userInfo' },
            {
                $project: {
                    _id: 1,
                    rewardCount: 1,
                    name: '$userInfo.name',
                    email: '$userInfo.email',
                },
            },
        ]);
        res.status(201).json({ top });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch top referrers' });
    }
};

export const getReferralStats = async (req: Request, res: Response) => {
    try {
        const [completed, pending, revoked, referrers] = await Promise.all([
            ReferralRewardHistory.countDocuments({ status: 'completed' }),
            ReferralRewardHistory.countDocuments({ status: 'pending' }),
            ReferralRewardHistory.countDocuments({ status: 'revoked' }),
            ReferralRewardHistory.distinct('user'),
        ]);

        res.status(201).json({
            totalCompleted: completed,
            totalPending: pending,
            totalRevoked: revoked,
            totalReferrers: referrers.length,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch referral stats' });
    }
}; 