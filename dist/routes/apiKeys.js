"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const apiKeyController_1 = require("../controllers/apiKeyController");
const auth_1 = __importDefault(require("../middleware/auth"));
const router = express_1.default.Router();
router.post('/', auth_1.default, apiKeyController_1.addApiKey);
router.get('/', auth_1.default, apiKeyController_1.getApiKeys);
router.delete('/:id', auth_1.default, apiKeyController_1.deleteApiKey);
exports.default = router;
//# sourceMappingURL=apiKeys.js.map