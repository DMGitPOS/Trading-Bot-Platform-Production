import express from "express";
import { createPayment, executePayment } from "../controllers/paypalController";
import { authenticateJWT } from '../middleware/auth';

const router = express.Router();

router.post("/create", authenticateJWT, createPayment);
router.post("/execute", authenticateJWT, executePayment);

export default router;
