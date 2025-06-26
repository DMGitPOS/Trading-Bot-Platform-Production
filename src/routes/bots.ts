import express from 'express';
import { createBot, listBots, updateBot, deleteBot, toggleBot, getBotLogs, getBotPerformance } from '../controllers/botController';
import auth from '../middleware/auth';

const router = express.Router();

router.post('/', auth, createBot);
router.get('/', auth, listBots);
router.put('/:id', auth, updateBot);
router.delete('/:id', auth, deleteBot);
router.post('/:id/toggle', auth, toggleBot);
router.get('/:id/logs', auth, getBotLogs);
router.get('/:id/performance', auth, getBotPerformance);

export default router; 