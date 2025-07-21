import express from 'express';
import {
    register,
    login,
    verifyEmail,
    forgotPassword,
    resetPassword,
    getMe,
    socialAuthCallback,
    updateProfile,
    changePassword,
} from '../controllers/authController';
import {
    setup2FA,
    enable2FA,
    verify2FA,
    disable2FA,
    verifyBackupCode,
    generateNewBackupCodes
} from '../controllers/twoFactorAuthController';
import { authenticateJWT, isAdmin } from '../middleware/auth';
import passport from 'passport';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const twoFALimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // 5 attempts
    message: 'Too many 2FA attempts, please try again later'
});

router.post('/register', register);
router.post('/login', login);
router.post('/verify-email', verifyEmail);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authenticateJWT, getMe);
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
router.get("/google/callback", passport.authenticate("google", { session: false }), socialAuthCallback);

router.put('/profile', authenticateJWT, updateProfile);
router.put('/change-password', authenticateJWT, changePassword);

// 2FA routes
router.post('/2fa/setup', authenticateJWT, setup2FA);
router.post('/2fa/enable', authenticateJWT, enable2FA);
router.post('/2fa/verify', twoFALimiter, verify2FA);
router.post('/2fa/disable', authenticateJWT, disable2FA);
router.post('/2fa/backup/verify', twoFALimiter, verifyBackupCode);
router.post('/2fa/backup/generate', authenticateJWT, generateNewBackupCodes);

export default router; 