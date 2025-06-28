import express from 'express';
import { addApiKey, getApiKeys, deleteApiKey, getApiKeyUsage, testApiKey } from '../controllers/apiKeyController';
import auth from '../middleware/auth';

const router = express.Router();

router.post('/', auth, addApiKey);
router.post('/test', auth, testApiKey);
router.get('/', auth, getApiKeys);
router.get('/:id/usage', auth, getApiKeyUsage);
router.delete('/:id', auth, deleteApiKey);

export default router; 