import { Router } from 'express';
import { uploadFile } from '../controllers/fileController';
import { authenticateJWT } from '../middleware/auth';

const router = Router();

router.post('/upload', authenticateJWT, uploadFile);

export default router;
