import express from "express";
import {
    getPreferences,
    updatePreferences,
    getNotificationFeed,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    clearAllNotifications
} from "../controllers/notificationController";
import { authenticateJWT } from "../middleware/auth";

const router = express.Router();

router.get("/preferences", authenticateJWT, getPreferences);
router.put("/preferences", authenticateJWT, updatePreferences);
router.get("/feed", authenticateJWT, getNotificationFeed);
router.post("/read/:id", authenticateJWT, markNotificationRead);
router.post("/read-all", authenticateJWT, markAllNotificationsRead);
router.delete("/delete/:id", authenticateJWT, deleteNotification);
router.delete("/clear", authenticateJWT, clearAllNotifications);

export default router; 