import express from 'express';
import { 
    createCheckoutSession, 
    handleWebhook, 
    createPortalSession,
    getSubscriptionAnalytics,
    getRecentSubscriptions
} from '../controllers/subscriptionController';
import { authenticateJWT, isAdmin } from '../middleware/auth';

const router = express.Router();

router.post('/create-checkout-session', authenticateJWT, (req, res, next) => {
    createCheckoutSession(req, res).catch(next);
});

router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

router.post('/create-portal-session', authenticateJWT, (req, res, next) => {
    createPortalSession(req, res).catch(next);
});

// Admin routes
router.get('/analytics', authenticateJWT, isAdmin, (req, res, next) => {
    getSubscriptionAnalytics(req, res).catch(next);
});

router.get('/recent', authenticateJWT, isAdmin, (req, res, next) => {
    getRecentSubscriptions(req, res).catch(next);
});

export default router; 