"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authController_1 = require("../controllers/authController");
const auth_1 = __importDefault(require("../middleware/auth"));
const passport_1 = __importDefault(require("passport"));
const router = express_1.default.Router();
router.post('/register', authController_1.register);
router.post('/login', authController_1.login);
router.post('/verify-email', authController_1.verifyEmail);
router.post('/forgot-password', authController_1.forgotPassword);
router.post('/reset-password', authController_1.resetPassword);
router.get('/me', auth_1.default, authController_1.getMe);
router.get('/trades', auth_1.default, authController_1.getUserTrades);
router.get('/google', passport_1.default.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport_1.default.authenticate('google', { session: false }), (req, res, next) => {
    (0, authController_1.googleAuthCallback)(req, res).catch(next);
});
router.put('/profile', auth_1.default, authController_1.updateProfile);
router.put('/change-password', auth_1.default, authController_1.changePassword);
exports.default = router;
//# sourceMappingURL=auth.js.map