"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteApiKey = exports.getApiKeys = exports.addApiKey = void 0;
const ApiKey_1 = __importDefault(require("../models/ApiKey"));
const crypto_1 = require("../utils/crypto");
const addApiKey = async (req, res) => {
    try {
        const { exchange, apiKey, apiSecret } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ message: 'Not authorized' });
            return;
        }
        if (!exchange || !apiKey || !apiSecret) {
            res.status(400).json({ message: 'Please provide exchange, API key, and secret' });
            return;
        }
        const newApiKey = new ApiKey_1.default({
            user: userId,
            exchange,
            apiKey,
            apiSecret,
        });
        await newApiKey.save();
        res.status(201).json({ message: 'API key added successfully' });
    }
    catch (error) {
        console.error('Error in addApiKey:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
exports.addApiKey = addApiKey;
const getApiKeys = async (req, res) => {
    console.log('getApiKeys');
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ message: 'Not authorized' });
            return;
        }
        const apiKeys = await ApiKey_1.default.find({ user: userId });
        const decryptedKeys = apiKeys.map(key => ({
            _id: key._id,
            exchange: key.exchange,
            apiKey: (0, crypto_1.decrypt)(key.apiKey),
            createdAt: key.createdAt,
        }));
        res.status(200).json(decryptedKeys);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
exports.getApiKeys = getApiKeys;
const deleteApiKey = async (req, res) => {
    try {
        const userId = req.user?.id;
        const keyId = req.params.id;
        if (!userId) {
            res.status(401).json({ message: 'Not authorized' });
            return;
        }
        const key = await ApiKey_1.default.findById(keyId);
        if (!key) {
            res.status(404).json({ message: 'API key not found' });
            return;
        }
        if (key.user.toString() !== userId) {
            res.status(401).json({ message: 'Not authorized' });
            return;
        }
        await ApiKey_1.default.findByIdAndDelete(keyId);
        res.status(200).json({ message: 'API key deleted successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
exports.deleteApiKey = deleteApiKey;
//# sourceMappingURL=apiKeyController.js.map