import express from 'express';
import authRoutes from './auth.routes';
import apiKeyRoutes from './apiKeys.routes';
import subscriptionRoutes from './stripe.routes';
import botsRoutes from './bots.routes';
import paypalRoutes from './paypal.routes';
import supportTicketRoutes from './supportTickets.routes';
import fileRoutes from './file.routes';
import supportTicketsRoutes from './supportTickets.routes';
import referralsRoutes from './referrals.routes';
import notificationsRoutes from './notifications.routes';
import usersRoutes from './users.routes';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/keys', apiKeyRoutes);
router.use('/subscription', subscriptionRoutes);
router.use('/bots', botsRoutes);
router.use('/paypal', paypalRoutes);
router.use('/support', supportTicketRoutes);
router.use('/files', fileRoutes);
router.use('/referrals', referralsRoutes);
router.use('/support-tickets', supportTicketsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/users', usersRoutes);

export default router;
