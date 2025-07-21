import { Request, Response } from "express";
import NotificationPreference from "../models/NotificationPreference";
import Notification from "../models/Notification";
import { AuthRequest } from "../middleware/auth";
import Joi from 'joi';

const notificationPreferencesSchema = Joi.object({
    email: Joi.boolean().required(),
    sms: Joi.boolean().required(),
    telegram: Joi.boolean().required(),
    discord: Joi.boolean().required(),
    smsNumber: Joi.string().allow('').optional(),
    telegramChatId: Joi.string().allow('').optional(),
    discordWebhook: Joi.string().allow('').optional(),
});

export const getPreferences = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const pref = await NotificationPreference.findOne({ user: userId });
        res.status(201).json(pref);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch preferences" });
    }
};

export const updatePreferences = async (req: Request, res: Response) => {
    try {
        const { error } = notificationPreferencesSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const update = {
            email: req.body.email,
            sms: req.body.sms,
            telegram: req.body.telegram,
            discord: req.body.discord,
            smsNumber: req.body.smsNumber,
            telegramChatId: req.body.telegramChatId,
            discordWebhook: req.body.discordWebhook,
        };
        const pref = await NotificationPreference.findOneAndUpdate(
            { user: userId },
            update,
            { upsert: true, new: true }
        );
        res.status(201).json(pref);
    } catch (err) {
        res.status(500).json({ error: "Failed to update preferences" });
    }
};

export const getNotificationFeed = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const { type } = req.query;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 100;
        const skip = (page - 1) * limit;
        const filter: any = { user: userId };
        if (type && type !== "all") filter.type = type;

        const total = await Notification.countDocuments(filter);
        const notifications = await Notification.find(filter)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);

        res.status(201).json({
            notifications,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch notifications" });
    }
};

export const markNotificationRead = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const { id } = req.params;
        const notification = await Notification.findOneAndUpdate(
            { _id: id, user: userId },
            { read: true },
            { new: true }
        );
        if (!notification) return res.status(404).json({ error: "Notification not found" });
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to mark notification as read" });
    }
};

export const markAllNotificationsRead = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        await Notification.updateMany({ user: userId, read: false }, { read: true });
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
};

export const deleteNotification = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const { id } = req.params;
        const result = await Notification.findOneAndDelete({ _id: id, user: userId });
        if (!result) return res.status(404).json({ error: 'Notification not found' });

        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete notification' });
    }
};

export const clearAllNotifications = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });
        
        await Notification.deleteMany({ user: userId });

        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clear notifications' });
    }
};