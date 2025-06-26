import express from 'express';
import { addApiKey, getApiKeys, deleteApiKey } from '../controllers/apiKeyController';
import auth from '../middleware/auth';

const router = express.Router();

router.post('/', auth, addApiKey);
router.get('/', auth, getApiKeys);
router.delete('/:id', auth, deleteApiKey);

export default router; 