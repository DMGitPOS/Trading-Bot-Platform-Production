import express from "express";
import {
    createTicket,
    getMyTickets,
    getAllTickets,
    respondToTicket,
    closeTicket,
} from "../controllers/supportTicketController";
import { authenticateJWT, isAdmin } from '../middleware/auth';

const router = express.Router();

router.post("/", authenticateJWT, createTicket);
router.get("/my", authenticateJWT, getMyTickets);

router.get("/", authenticateJWT, isAdmin, getAllTickets);
router.post("/:id/respond", authenticateJWT, isAdmin, respondToTicket);
router.post("/:id/close", authenticateJWT, isAdmin, closeTicket);

export default router;
