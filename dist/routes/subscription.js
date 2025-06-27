"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const subscriptionController_1 = require("../controllers/subscriptionController");
const auth_1 = __importDefault(require("../middleware/auth"));
const router = express_1.default.Router();
router.post('/create-checkout-session', auth_1.default, (req, res, next) => {
    (0, subscriptionController_1.createCheckoutSession)(req, res).catch(next);
});
router.post('/create-portal-session', auth_1.default, (req, res, next) => {
    (0, subscriptionController_1.createPortalSession)(req, res).catch(next);
});
router.post('/webhook', express_1.default.raw({ type: 'application/json' }), (req, res, next) => {
    (0, subscriptionController_1.handleWebhook)(req, res).catch(next);
});
exports.default = router;
//# sourceMappingURL=subscription.js.map