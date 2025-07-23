import express from 'express';
import {
    createStrategy,
    getStrategies,
    getStrategy,
    updateStrategy,
    deleteStrategy
} from '../controllers/strategyController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

router.post('/', authenticateJWT, createStrategy);
router.get('/', authenticateJWT, getStrategies);
router.get('/:id', authenticateJWT, getStrategy);
router.put('/:id', authenticateJWT, updateStrategy);
router.delete('/:id', authenticateJWT, deleteStrategy);

export default router; 