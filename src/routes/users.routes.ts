import express from 'express';
import {
    listUsers,
    updateUser,
    deleteUser
} from '../controllers/usersController';
import { authenticateJWT, isAdmin } from '../middleware/auth';

const router = express.Router();

router.get('/', authenticateJWT, isAdmin, listUsers);
router.put('/user/:id', authenticateJWT, isAdmin, updateUser);
router.delete('/user/:id', authenticateJWT, isAdmin, deleteUser);

export default router;