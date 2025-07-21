import express from 'express';
import { authenticateJWT, isAdmin } from '../middleware/auth';
import {
    getReferralRewardHistory,
    listAllReferralRewards,
    creditReferralReward,
    revokeReferralReward,
    getTopReferrers,
    getReferralStats
} from '../controllers/referralController';

const router = express.Router();

router.get('/history', authenticateJWT, getReferralRewardHistory);
router.get('/rewards', authenticateJWT, isAdmin, listAllReferralRewards);
router.post('/rewards/credit', authenticateJWT, isAdmin, creditReferralReward);
router.post('/rewards/revoke', authenticateJWT, isAdmin, revokeReferralReward);
router.get('/leaderboard', getTopReferrers);
router.get('/stats', getReferralStats);

export default router; 