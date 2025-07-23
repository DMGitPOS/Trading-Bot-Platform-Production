import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Joi from 'joi';
import path from 'path';
import { UploadedFile } from 'express-fileupload';
import User from "../models/User";
import { sendVerificationEmail,
  sendResetPasswordEmail } from "../services/email.service";
import { TwoFactorAuthService } from "../services/twoFactorAuth.service";
import { handleFileUpload, UPLOAD_DIR } from "./fileController";
import { AuthRequest } from "../middleware/auth";
import ReferralRewardHistory from '../models/ReferralRewardHistory';
import NotificationPreference from "../models/NotificationPreference";
import { notifyUser } from '../services/notification/notifyUser';

const registerSchema = Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    referralCode: Joi.string().optional(),
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    twoFAToken: Joi.string()
});

const verifyEmailSchema = Joi.object({
    token: Joi.string().required(),
});

const forgotPasswordSchema = Joi.object({
    email: Joi.string().email().required(),
});

const resetPasswordSchema = Joi.object({
    token: Joi.string().required(),
    password: Joi.string().min(6).required(),
});

const updateProfileSchema = Joi.object({
    name: Joi.string().min(2).max(50).required(),
});

const changePasswordSchema = Joi.object({
    newPassword: Joi.string().min(6).required(),
    currentPassword: Joi.string(),
    
});

const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'default_jwt_secret';

export const register = async (req: Request, res: Response) => {
    try {
        const { error } = registerSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { name, email, password, referralCode } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(409).json({
          error: 'Email already registered'
        });

        const hashedPassword = await bcrypt.hash(password, 10);

        // Prepare new user data
        const newUserData: any = {
            name,
            email,
            password: hashedPassword,
        };

        // Handle referral logic
        if (referralCode) {
            const referrer = await User.findOne({ referralCode });
            if (referrer) {
                newUserData.referredBy = referrer._id;
            }
        }

        const user = await User.create(newUserData);

        // If referred, update referrer's referrals and rewards, and create reward history
        if (user.referredBy) {
            await User.findByIdAndUpdate(
                user.referredBy,
                {
                    $push: { referrals: user._id },
                    $inc: { referralRewards: 1 },
                }
            );
            // Create referral reward history (pending until email verification)
            await ReferralRewardHistory.create({
                user: user.referredBy,
                referredUser: user._id,
                rewardAmount: 1,
                status: 'pending',
                description: `Reward for referring user ${user.email}`,
            });
            // Notify referrer by email
            const referrer = await User.findById(user.referredBy);
            if (referrer && referrer.email) {
                await notifyUser({
                    userId: String(referrer._id),
                    type: 'referral',
                    message: `Congratulations! You earned a reward for referring ${user.email}.`,
                });
            }
        }

        const verifyEmailToken = user.generateEmailVerificationToken(email);
        const verificationUrl = user.createVerificationUrl(verifyEmailToken);
        await user.save();

        await sendVerificationEmail(email, verificationUrl);

        res.status(201).json({
            success: true
        });
    } catch (err) {
        res.status(500).json({ error: 'Registration failed' });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { error } = loginSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { email, password, twoFAToken } = req.body;

        const user = await User.findOne({ email }).select('+password');
        if (!user) return res.status(401).json({ error: 'Invalid your email' });

        const isMatch = await user.comparePassword(password);
        if (!isMatch) return res.status(401).json({ error: 'Invalid your password' });

        if (!user.isEmailVerified) {
            return res.status(401).json({ error: 'Please verify your email first' });
        }

        if (user.twoFAEnabled) {
            if (!twoFAToken) {
                return res.status(201).json({ requires2FA: true });
            }
      
            if (!user.twoFASecret) {
                return res.status(500).json({ error: '2FA configuration error' });
            }
      
            const isValid = TwoFactorAuthService.verifyToken(user.twoFASecret, twoFAToken);
            if (!isValid) {
                return res.status(400).json({ error: 'Invalid 2FA token' });
            }
      
            user.twoFAVerified = true;
            await user.save();
        }
        
        const token = jwt.sign(
          { id: user._id, email: user.email },
          JWT_SECRET_KEY,
          { expiresIn: '7d' }
        );

        res.status(201).json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                role: user.role,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionPlan: user.subscriptionPlan,
                hasPassword: !!user.password,
                twoFAEnabled: user.twoFAEnabled,
                referralCode: user.referralCode
            },
        });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
};

export const verifyEmail = async (req: Request, res: Response) => {
    try {
        const { error } = verifyEmailSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { token } = req.body;

        const user = await User.findOne({
            verifyEmailToken: token,
            verifyEmailExpire: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired verification token' });
        }

        if (user.isEmailVerified) {
            return res.status(400).json({ error: 'Email is already verified' });
        }

        user.isEmailVerified = true;
        user.verifyEmailToken = undefined;
        user.verifyEmailExpire = undefined;
        await user.save();

        // Referral reward: complete if pending
        if (user.referredBy) {
            const pendingReward = await ReferralRewardHistory.findOne({
                user: user.referredBy,
                referredUser: user._id,
                status: 'pending',
            });
            if (pendingReward) {
                pendingReward.status = 'completed';
                await pendingReward.save();
                // Increment referrer's reward count
                await User.findByIdAndUpdate(user.referredBy, { $inc: { referralRewards: 1 } });
                // Notify referrer by email
                const referrer = await User.findById(user.referredBy);
                if (referrer && referrer.email) {
                    await notifyUser({
                        userId: String(referrer._id),
                        type: 'referral',
                        message: `Congratulations! You earned a reward for referring ${user.email} (after they verified their email).`,
                    });
                }
            }
        }

        const pref = new NotificationPreference({
            user: user._id,
        });

        await pref.save();

        res.status(201).json({
            success: true
        });
    } catch (error) {
        res.status(500).json({ error: 'Email verification failed' });
    }
};

export const forgotPassword = async (req: Request, res: Response) => {
    try {
        const { error } = forgotPasswordSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { email } = req.body;

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });        

        const resetToken = user.generateEmailVerificationToken(email);
        const resetUrl = user.resetPasswordUrl(resetToken);
        await user.save();

        await sendResetPasswordEmail(email, resetUrl);

        res.status(201).json({
            success: true
        });
    } catch (error) {
        res.status(500).json({ error: 'Password reset request failed' });
    }
};

export const resetPassword = async (req: Request, res: Response) => {
    try {
        const { error } = resetPasswordSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { token, password } = req.body;

        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpire: { $gt: Date.now() },
        });

        if (!user) return res.status(400).json({ error: 'Invalid or expired password reset token' });    

        const hashedPassword = await bcrypt.hash(password, 10);
        user.password = hashedPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();

        res.status(201).json({
            success: true
        });
    } catch (error) {
        res.status(500).json({ error: 'Password reset failed' });
    }
};

export const updateProfile = async (req: Request, res: Response) => {
    try {
        const { error } = updateProfileSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });
        
        const { name } = req.body;
        let filePath = '';
        if (req.files && Object.keys(req.files).length > 0) {
            const uploadedFile = req.files.file as UploadedFile;
        
            const uploadPath = await handleFileUpload(uploadedFile, UPLOAD_DIR);
            const fileName = path.basename(uploadPath);
            filePath = `/uploads/${fileName}`;
        }

        const update: Partial<{ name: string; avatar: string }> = {};
        if (name) update.name = name;
        if (filePath) update.avatar = filePath;

        const user = await User.findByIdAndUpdate(
            userId,
            update, 
            { new: true }
        );

        if (!user) return res.status(404).json({ message: 'User not found' });

        res.status(201).json({
            name: user.name,
            avatar: user.avatar,
        });
    } catch (error) {
        res.status(500).json({ error: 'Update profile failed' });
    }
};

export const changePassword = async (req: Request, res: Response) => {
    try {
        const { error } = changePasswordSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(userId).select('+password');
        if (!user) return res.status(401).json({ error: 'User not found' });

        if (user.password) {
            if (!currentPassword) return res.status(401).json({ error: 'Current password is required' });

            const isMatch = await user.comparePassword(currentPassword);
            if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Change password failed' });
    }
};

export const socialAuthCallback = async (req: Request & { user?: any }, res: Response) => {
    try {
        const user = req.user;

        const token = jwt.sign(
            { id: user._id, email: user.email },
            JWT_SECRET_KEY,
            { expiresIn: '7d' }
        );

        const responseData = {
            message: "Login successful",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                avatar: user.avatar,
                referralCode: user.referralCode,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionPlan: user.subscriptionPlan,
                hasPassword: !!user.password,
                twoFAEnabled: user.twoFAEnabled
            },
            token,
        };

        const encodedData = encodeURIComponent(JSON.stringify(responseData));
        res.redirect(`${process.env.FRONTEND_BASE_URL}/social-callback?data=${encodedData}`);
    } catch (err) {
        res.status(500).json({ error: 'Social authentication failed' });
    }
};

export const getMe = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const user = await User.findById(userId).select('+password');
        if (!user) return res.status(404).json({ message: "User not found" });

        // Populate referrals with basic info
        const populatedUser = await user.populate({
            path: 'referrals',
            select: 'name email _id',
        });

        res.json({
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            avatar: user.avatar,
            subscriptionStatus: user.subscriptionStatus,
            subscriptionPlan: user.subscriptionPlan,
            hasPassword: !!user.password,
            twoFAEnabled: user.twoFAEnabled,
            referralCode: user.referralCode,
            referredBy: user.referredBy,
            referrals: populatedUser.referrals,
            referralRewards: user.referralRewards,
        });
    } catch (err) {
        res.status(500).json({ error: 'Get your infomation failed' });
    }
};
