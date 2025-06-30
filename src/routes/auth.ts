import express from 'express';
import {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getMe,
  googleAuthCallback,
  getUserTrades,
  updateProfile,
  changePassword,
} from '../controllers/authController';
import { setup2FA, enable2FA, verify2FA, disable2FA, verifyBackupCode, generateNewBackupCodes } from '../controllers/twoFactorAuthController';
import auth from '../middleware/auth';
import passport from 'passport';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per windowMs
  message: 'Too many attempts, please try again later'
});

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
router.get('/me', auth, getMe);
router.get('/trades', auth, getUserTrades);
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport.authenticate('google', { session: false }), (req, res, next) => {
  googleAuthCallback(req, res).catch(next);
});
router.put('/profile', auth, updateProfile);
router.put('/change-password', auth, changePassword);

// 2FA routes
router.post('/2fa/setup', auth, setup2FA);
router.post('/2fa/enable', auth, enable2FA);
router.post('/2fa/verify', twoFALimiter, verify2FA);
router.post('/2fa/disable', auth, disable2FA);
router.post('/2fa/backup/verify', twoFALimiter, verifyBackupCode);
router.post('/2fa/backup/generate', auth, generateNewBackupCodes);

export default router; 