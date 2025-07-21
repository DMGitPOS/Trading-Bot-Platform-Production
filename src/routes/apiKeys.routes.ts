import express from 'express';
import { addApiKey, getApiKeys, deleteApiKey, getApiKeyUsage, testApiKey } from '../controllers/apiKeyController';
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

router.post('/', authenticateJWT, addApiKey);
router.post('/test', authenticateJWT, testApiKey);
router.get('/', authenticateJWT, getApiKeys);
router.get('/:id/usage', authenticateJWT, getApiKeyUsage);
router.delete('/:id', authenticateJWT, deleteApiKey);

export default router; 