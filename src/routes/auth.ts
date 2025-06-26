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
import auth from '../middleware/auth';
import passport from 'passport';

const router = express.Router();

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

export default router; 