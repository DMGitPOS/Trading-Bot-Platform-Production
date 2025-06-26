import express from 'express';
import { createCheckoutSession, handleWebhook, createPortalSession } from '../controllers/subscriptionController';
import auth from '../middleware/auth';

const router = express.Router();

router.post('/create-checkout-session', auth, (req, res, next) => {
  createCheckoutSession(req, res).catch(next);
});

router.post('/create-portal-session', auth, (req, res, next) => {
  createPortalSession(req, res).catch(next);
});

router.post('/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  handleWebhook(req, res).catch(next);
});

export default router; 