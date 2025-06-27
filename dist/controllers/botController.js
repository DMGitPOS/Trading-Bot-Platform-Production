"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBotPerformance = exports.getBotLogs = exports.toggleBot = exports.deleteBot = exports.updateBot = exports.listBots = exports.createBot = void 0;
const Bot_1 = __importDefault(require("../models/Bot"));
const User_1 = __importDefault(require("../models/User"));
const BotLog_1 = __importDefault(require("../models/BotLog"));
const ApiKey_1 = __importDefault(require("../models/ApiKey"));
const createBot = async (req, res) => {
    const userId = req.user?.id;
    const { name, exchange, apiKeyRef, strategy } = req.body;
    const user = await User_1.default.findById(userId);
    if (!user) {
        res.status(404).json({ message: 'User not found' });
        return;
    }
    if (user.subscriptionStatus !== 'active') {
        res.status(403).json({ message: 'You must have an active subscription to create a bot.' });
        return;
    }
    const apiKey = await ApiKey_1.default.findOne({ _id: apiKeyRef, user: userId });
    if (!apiKey) {
        res.status(400).json({ message: 'Invalid API key reference.' });
        return;
    }
    const botCount = await Bot_1.default.countDocuments({ user: userId });
    if (user.subscriptionPlan === 'Basic' && botCount >= 2) {
        res.status(403).json({ message: 'Basic plan allows up to 2 bots.' });
        return;
    }
    const bot = new Bot_1.default({
        user: userId,
        name,
        exchange,
        apiKeyRef,
        strategy,
        status: 'stopped',
    });
    await bot.save();
    res.status(201).json({ bot });
};
exports.createBot = createBot;
const listBots = async (req, res) => {
    const userId = req.user?.id;
    const bots = await Bot_1.default.find({ user: userId });
    res.json({ bots });
};
exports.listBots = listBots;
const updateBot = async (req, res) => {
    const userId = req.user?.id;
    const botId = req.params.id;
    const { name, strategy } = req.body;
    const bot = await Bot_1.default.findOne({ _id: botId, user: userId });
    if (!bot) {
        res.status(404).json({ message: 'Bot not found' });
        return;
    }
    if (name)
        bot.name = name;
    if (strategy)
        bot.strategy = strategy;
    await bot.save();
    res.json({ bot });
};
exports.updateBot = updateBot;
const deleteBot = async (req, res) => {
    const userId = req.user?.id;
    const botId = req.params.id;
    const bot = await Bot_1.default.findOneAndDelete({ _id: botId, user: userId });
    if (!bot) {
        res.status(404).json({ message: 'Bot not found' });
        return;
    }
    res.json({ message: 'Bot deleted' });
};
exports.deleteBot = deleteBot;
const toggleBot = async (req, res) => {
    const userId = req.user?.id;
    const botId = req.params.id;
    const { action } = req.body;
    const bot = await Bot_1.default.findOne({ _id: botId, user: userId });
    if (!bot) {
        res.status(404).json({ message: 'Bot not found' });
        return;
    }
    if (action === 'start') {
        bot.status = 'running';
    }
    else if (action === 'stop') {
        bot.status = 'stopped';
    }
    else {
        res.status(400).json({ message: 'Invalid action' });
        return;
    }
    await bot.save();
    res.json({ bot });
};
exports.toggleBot = toggleBot;
const getBotLogs = async (req, res) => {
    const userId = req.user?.id;
    const botId = req.params.id;
    const bot = await Bot_1.default.findOne({ _id: botId, user: userId });
    if (!bot) {
        res.status(404).json({ message: 'Bot not found' });
        return;
    }
    const logs = await BotLog_1.default.find({ bot: botId }).sort({ timestamp: -1 });
    res.json({ logs });
};
exports.getBotLogs = getBotLogs;
const getBotPerformance = async (req, res) => {
    const userId = req.user?.id;
    const botId = req.params.id;
    const bot = await Bot_1.default.findOne({ _id: botId, user: userId });
    if (!bot) {
        res.status(404).json({ message: 'Bot not found' });
        return;
    }
    res.json({ performance: bot.performance });
};
exports.getBotPerformance = getBotPerformance;
//# sourceMappingURL=botController.js.map