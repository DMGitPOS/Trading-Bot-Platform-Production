import express from 'express';
import {
    listUsers,
    updateUser,
    deleteUser,
    addSubscription,
    removeSubscription,
    getManualSubscriptionUsers
} from '../controllers/usersController';
import { authenticateJWT, isAdmin } from '../middleware/auth';

const router = express.Router();

router.get('/', authenticateJWT, isAdmin, listUsers);
router.put('/user/:id', authenticateJWT, isAdmin, updateUser);
router.delete('/user/:id', authenticateJWT, isAdmin, deleteUser);
router.put('/user/:id/addsubscription', authenticateJWT, isAdmin, addSubscription);
router.put('/user/:id/removesubscription', authenticateJWT, isAdmin, removeSubscription);
router.get('/manual-subscription-users', authenticateJWT, isAdmin, getManualSubscriptionUsers);

export default router;