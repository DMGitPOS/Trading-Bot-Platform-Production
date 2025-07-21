import express from 'express';
import {
    createBot,
    getAllBots,
    updateBot,
    deleteBot,
    toggleBot,
    getBotLogs,
    getBotPerformance,
    backtestBot,
    testBotRun,
    updatePaperTradingConfig,
    getPaperTrades,
    getPaperTradingStats,
    updateBotApiKey,
    backtestBotStrategy,
    getBotStatus,
    getBotOpenPositions,
    getUserTrades
} from '../controllers/botController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

router.post('/', authenticateJWT, createBot);
router.get('/', authenticateJWT, getAllBots);
router.put('/:id', authenticateJWT, updateBot);
router.delete('/:id', authenticateJWT, deleteBot);
router.post('/:id/toggle', authenticateJWT, toggleBot);
router.get('/:id/logs', authenticateJWT, getBotLogs);
router.get('/:id/performance', authenticateJWT, getBotPerformance);
router.post('/backtest', authenticateJWT, backtestBot);
router.post('/backtest-strategy', authenticateJWT, backtestBotStrategy);
router.post('/:id/test', authenticateJWT, testBotRun);
router.put('/:id/api-key', authenticateJWT, updateBotApiKey);
router.get('/:id/status', authenticateJWT, getBotStatus);
router.get('/:id/open-positions', authenticateJWT, getBotOpenPositions);
router.get('/trades', authenticateJWT, getUserTrades);

// Paper trading endpoints
router.put('/:id/paper-config', authenticateJWT, updatePaperTradingConfig);
router.get('/:id/paper-trades', authenticateJWT, getPaperTrades);
router.get('/:id/paper-stats', authenticateJWT, getPaperTradingStats);

export default router;
