import { Request, Response } from 'express';
import { TwoFactorAuthService } from '../services/2fa/twoFactorAuth.service';
import User from '../models/User';
import { sendEmail } from '../services/email/email.service';
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "secret";

/**
 * Initialize 2FA setup for a user
 * Returns QR code and secret for the authenticator app
 */
export const setup2FA = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const user = await User.findById(userId);
    
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (user.twoFAEnabled) {
      res.status(400).json({ message: '2FA is already enabled' });
      return;
    }

    // Generate new secret
    const secretData = await TwoFactorAuthService.generateSecret(user.email);
    
    // Store temporary secret
    user.tempSecret = secretData.secret;
    await user.save();

    res.json({
      qrcode: secretData.qrcode,
      secret: secretData.secret,
      message: 'Scan the QR code with your authenticator app'
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ message: 'Failed to setup 2FA' });
  }
};

/**
 * Verify and enable 2FA for a user
 * Requires a valid token from the authenticator app
 */
export const enable2FA = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body;
    const userId = (req.user as { id: string }).id;
    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (user.twoFAEnabled) {
      res.status(400).json({ message: '2FA is already enabled' });
      return;
    }

    if (!user.tempSecret) {
      res.status(400).json({ message: '2FA setup not initiated' });
      return;
    }

    // Verify the token
    const isValid = TwoFactorAuthService.verifyToken(user.tempSecret, token);
    if (!isValid) {
      res.status(400).json({ message: 'Invalid verification code' });
      return;
    }

    // Generate backup codes
    const { hashedCodes, plainCodes } = TwoFactorAuthService.generateBackupCodes();

    // Enable 2FA
    user.twoFASecret = user.tempSecret;
    user.tempSecret = undefined;
    user.twoFAEnabled = true;
    user.twoFAVerified = true;
    user.backupCodes = hashedCodes;
    await user.save();

    // Send backup codes via email
    await sendEmail(
      user.email,
      '2FA Backup Codes - Keep Safe',
      `Your backup codes for two-factor authentication:\n\n${plainCodes.join('\n')}\n\nKeep these codes safe and secure. Each code can only be used once.`
    );

    res.json({
      message: 'Two-factor authentication enabled successfully',
      backupCodes: plainCodes
    });
  } catch (error) {
    console.error('2FA enable error:', error);
    res.status(500).json({ message: 'Failed to enable 2FA' });
  }
};

/**
 * Verify 2FA token during login
 */
export const verify2FA = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (!user.twoFAEnabled || !user.twoFASecret) {
      res.status(400).json({ message: '2FA is not enabled' });
      return;
    }

    const isValid = TwoFactorAuthService.verifyToken(user.twoFASecret, token);
    if (!isValid) {
      res.status(400).json({ message: 'Invalid verification code' });
      return;
    }

    user.twoFAVerified = true;
    await user.save();

    // Generate JWT token
    const jwtToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1d' });

    res.json({
      token: jwtToken,
      user: {
        email: user.email,
        name: user.name,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionPlan: user.subscriptionPlan,
        hasPassword: !!user.password,
        twoFAEnabled: user.twoFAEnabled
      }
    });
  } catch (error) {
    console.error('2FA verification error:', error);
    res.status(500).json({ message: 'Failed to verify 2FA' });
  }
};

/**
 * Disable 2FA for a user
 * Requires current password and 2FA token for security
 */
export const disable2FA = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body;
    const userId = (req.user as { id: string }).id;
    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    console.log('enabled', user.twoFAEnabled);
    console.log('secret', user.twoFASecret);

    if (!user.twoFAEnabled || !user.twoFASecret) {
      res.status(400).json({ message: '2FA is not enabled' });
      return;
    }

    // Verify the token one last time
    const isValid = TwoFactorAuthService.verifyToken(user.twoFASecret, token);
    if (!isValid) {
      res.status(400).json({ message: 'Invalid verification code' });
      return;
    }

    // Disable 2FA
    user.twoFAEnabled = false;
    user.twoFASecret = undefined;
    user.twoFAVerified = false;
    user.backupCodes = [];
    await user.save();

    res.json({ message: 'Two-factor authentication disabled successfully' });
  } catch (error) {
    console.error('2FA disable error:', error);
    res.status(500).json({ message: 'Failed to disable 2FA' });
  }
};

/**
 * Verify backup code and grant access
 */
export const verifyBackupCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (!user.twoFAEnabled || !user.backupCodes || user.backupCodes.length === 0) {
      res.status(400).json({ message: '2FA is not properly configured' });
      return;
    }

    const codeIndex = TwoFactorAuthService.verifyBackupCode(code, user.backupCodes);
    if (codeIndex === -1) {
      res.status(400).json({ message: 'Invalid backup code' });
      return;
    }

    // Remove the used backup code
    user.backupCodes = user.backupCodes.filter((_, index) => index !== codeIndex);
    user.twoFAVerified = true;
    await user.save();

    // If this was the last backup code, notify user to generate new ones
    if (user.backupCodes.length === 0) {
      await sendEmail(
        user.email,
        'Generate New Backup Codes',
        'You have used your last backup code. Please generate new backup codes for your account security.'
      );
    }

    // Generate JWT token
    const jwtToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1d' });

    res.json({
      token: jwtToken,
      user: {
        email: user.email,
        name: user.name,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionPlan: user.subscriptionPlan,
        hasPassword: !!user.password,
        twoFAEnabled: user.twoFAEnabled
      }
    });
  } catch (error) {
    console.error('Backup code verification error:', error);
    res.status(500).json({ message: 'Failed to verify backup code' });
  }
};

/**
 * Generate new backup codes
 */
export const generateNewBackupCodes = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (!user.twoFAEnabled) {
      res.status(400).json({ message: '2FA is not enabled' });
      return;
    }

    // Generate new backup codes
    const { hashedCodes, plainCodes } = TwoFactorAuthService.generateBackupCodes();

    // Update user's backup codes
    user.backupCodes = hashedCodes;
    await user.save();

    // Send new backup codes via email
    await sendEmail(
      user.email,
      'New 2FA Backup Codes - Keep Safe',
      `Your new backup codes for two-factor authentication:\n\n${plainCodes.join('\n')}\n\nKeep these codes safe and secure. Each code can only be used once.`
    );

    res.json({
      message: 'New backup codes generated successfully',
      backupCodes: plainCodes
    });
  } catch (error) {
    console.error('Backup codes generation error:', error);
    res.status(500).json({ message: 'Failed to generate new backup codes' });
  }
}; 