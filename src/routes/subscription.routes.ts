import express from 'express';
import { 
    createSubscription,
    getSubscriptions,
    updateSubscription,
} from '../controllers/subscriptionController';
import { authenticateJWT, isAdmin } from '../middleware/auth';

const router = express.Router();

router.post('/', authenticateJWT, isAdmin, createSubscription);
router.get('/', authenticateJWT, getSubscriptions);
router.put('/:id', authenticateJWT, isAdmin, updateSubscription);
// router.post('/test', testCreateSubscription);

export default router; 