import Joi from 'joi';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import User, { IUser } from '../models/User';
import { sendEmail } from '../services/email.service';
import { TwoFactorAuthService } from '../services/twoFactorAuth.service';

const JWT_SECRET_KEY: string = process.env.JWT_SECRET_KEY || 'default_jwt_secret';

const enable2FASchema = Joi.object({
    token: Joi.string().required(),
});

const verify2FASchema = Joi.object({
    token: Joi.string().required(),
    email: Joi.string().email().required(),
});

const disable2FASchema = Joi.object({
    token: Joi.string().required(),
});

const verifyBackupCodeSchema = Joi.object({
    code: Joi.string().required(),
    email: Joi.string().email().required(),
});

export const setup2FA = async (
    req: Request,
    res: Response
): Promise<Response | void> => {
    try {
        const userId = (req.user as { id: string }).id;
        if (!userId) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const user: IUser | null = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.twoFAEnabled) {
            return res.status(400).json({ message: '2FA is already enabled' });
        }

        const secretData = await TwoFactorAuthService.generateSecret(user.email);
        user.tempSecret = secretData.secret;
        await user.save();

        res.status(201).json({
            qrcode: secretData.qrcode,
            secret: secretData.secret,
        });
    } catch (error) {
        res.status(500).json({ message: 'Setup 2FA failed' });
    }
};

export const enable2FA = async (
    req: Request,
    res: Response
): Promise<Response | void> => {
    try {
        const { error } = enable2FASchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { token } = req.body;
        const userId = (req.user as { id: string }).id;
        if (!userId) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const user: IUser | null = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.twoFAEnabled) {
            return res.status(400).json({ message: '2FA is already enabled' });
        }
        if (!user.tempSecret) {
            return res.status(400).json({ message: '2FA setup not initiated' });
        }

        const isValid = TwoFactorAuthService.verifyToken(user.tempSecret, token);
        if (!isValid) {
            return res.status(400).json({ message: 'Invalid verification code' });
        }

        const { hashedCodes, plainCodes } = TwoFactorAuthService.generateBackupCodes();
        user.twoFASecret = user.tempSecret;
        user.tempSecret = undefined;
        user.twoFAEnabled = true;
        user.twoFAVerified = true;
        user.backupCodes = hashedCodes;
        await user.save();

        await sendEmail(
            user.email,
            '2FA Backup Codes - Keep Safe',
            `Your backup codes for two-factor authentication:\n\n${plainCodes.join('\n')}\n\nKeep these codes safe and secure. Each code can only be used once.`
        );

        res.json({
            backupCodes: plainCodes
          });
    } catch (error) {
        res.status(500).json({ message: 'Enable 2FA failed' });
    }
};

export const verify2FA = async (
    req: Request,
    res: Response
): Promise<Response | void> => {
    try {
        const { error } = verify2FASchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { token, email } = req.body;
        const user: IUser | null = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!user.twoFAEnabled || !user.twoFASecret) {
            return res.status(400).json({ message: '2FA is not enabled' });
        }

        const isValid = TwoFactorAuthService.verifyToken(user.twoFASecret, token);
        if (!isValid) {
            return res.status(400).json({ message: 'Invalid verification code' });
        }

        user.twoFAVerified = true;
        await user.save();

        const jwtToken = jwt.sign(
            { id: user._id, email: user.email },
            JWT_SECRET_KEY,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            token: jwtToken,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                role: user.role,
                referralCode: user.referralCode,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionPlan: user.subscriptionPlan,
                hasPassword: !!user.password,
                twoFAEnabled: user.twoFAEnabled,
            },
        });
    } catch (error) {
        res.status(500).json({ message: 'Verify 2FA failed' });
    }
};

export const disable2FA = async (
    req: Request,
    res: Response
): Promise<Response | void> => {
    try {
        const { error } = disable2FASchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { token } = req.body;
        const userId = (req.user as { id: string }).id;
        if (!userId) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const user: IUser | null = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!user.twoFAEnabled || !user.twoFASecret) {
            return res.status(400).json({ message: '2FA is not enabled' });
        }

        const isValid = TwoFactorAuthService.verifyToken(user.twoFASecret, token);
        if (!isValid) {
            return res.status(400).json({ message: 'Invalid verification code' });
        }

        user.twoFAEnabled = false;
        user.twoFASecret = undefined;
        user.twoFAVerified = false;
        user.backupCodes = [];
        await user.save();

        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Disable 2FA failed' });
    }
};

export const verifyBackupCode = async (
    req: Request,
    res: Response
): Promise<Response | void> => {
    try {
        const { error } = verifyBackupCodeSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { code, email } = req.body;
        const user: IUser | null = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!user.twoFAEnabled || !user.backupCodes || user.backupCodes.length === 0) {
            return res.status(400).json({ message: '2FA is not properly configured' });
        }

        const codeIndex = TwoFactorAuthService.verifyBackupCode(code, user.backupCodes);
        if (codeIndex === -1) {
            return res.status(400).json({ message: 'Invalid backup code' });
        }

        user.backupCodes = user.backupCodes.filter((_, index) => index !== codeIndex);
        user.twoFAVerified = true;
        await user.save();

        if (user.backupCodes.length === 0) {
            await sendEmail(
                user.email,
                'Generate New Backup Codes',
                'You have used your last backup code. Please generate new backup codes for your account security.'
            );
        }

        const jwtToken = jwt.sign(
            { id: user._id, email: user.email },
            JWT_SECRET_KEY,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            token: jwtToken,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                avatar: user.avatar,
                role: user.role,
                referralCode: user.referralCode,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionPlan: user.subscriptionPlan,
                hasPassword: !!user.password,
                twoFAEnabled: user.twoFAEnabled,
            },
        });
    } catch (error) {
        res.status(500).json({ message: 'Verify backup code failed' });
    }
};

export const generateNewBackupCodes = async (
    req: Request,
    res: Response
): Promise<Response | void> => {
    try {
        const userId = (req.user as { id: string }).id;
        if (!userId) {
            return res.status(401).json({ error: 'Not authorized' });
        }

        const user: IUser | null = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!user.twoFAEnabled) {
            return res.status(400).json({ message: '2FA is not enabled' });
        }

        const { hashedCodes, plainCodes } = TwoFactorAuthService.generateBackupCodes();
        user.backupCodes = hashedCodes;
        await user.save();

        await sendEmail(
            user.email,
            'New 2FA Backup Codes - Keep Safe',
            `Your new backup codes for two-factor authentication:\n\n${plainCodes.join('\n')}\n\nKeep these codes safe and secure. Each code can only be used once.`
        );

        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Generate new backup codes failed' });
    }
}; 