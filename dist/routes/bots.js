"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const botController_1 = require("../controllers/botController");
const auth_1 = __importDefault(require("../middleware/auth"));
const router = express_1.default.Router();
router.post('/', auth_1.default, botController_1.createBot);
router.get('/', auth_1.default, botController_1.listBots);
router.put('/:id', auth_1.default, botController_1.updateBot);
router.delete('/:id', auth_1.default, botController_1.deleteBot);
router.post('/:id/toggle', auth_1.default, botController_1.toggleBot);
router.get('/:id/logs', auth_1.default, botController_1.getBotLogs);
router.get('/:id/performance', auth_1.default, botController_1.getBotPerformance);
exports.default = router;
//# sourceMappingURL=bots.js.map