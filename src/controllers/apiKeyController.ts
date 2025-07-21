import { Request, Response } from 'express';
import Joi from 'joi';
import ApiKey from '../models/ApiKey';
import Bot from '../models/Bot';
import { decrypt } from '../utils/crypto';
import { ExchangeFactory } from '../services/exchange/ExchangeFactory';
import { AuthRequest } from "../middleware/auth";

const addApiKeySchema = Joi.object({
    exchange: Joi.string().required(),
    apiKey: Joi.string().required(),
    apiSecret: Joi.string().required(),
});

const idSchema = Joi.object({
    id: Joi.string().required()
});

export const addApiKey = async (req: Request, res: Response) => {
    try {
        const { error } = addApiKeySchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { exchange, apiKey, apiSecret } = req.body;

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const supportedExchanges = ExchangeFactory.getSupportedExchanges();
        if (!supportedExchanges.includes(exchange.toLowerCase())) {
            return res.status(400).json({ 
                error: `Unsupported exchange: ${exchange}. Supported exchanges: ${supportedExchanges.join(', ')}`
            });
        }

        // Validate API key format (basic validation)
        if (apiKey.length < 10) {
            return res.status(400).json({ error: 'API key appears to be invalid (too short)' });
        }
        if (apiSecret.length < 10) {
            return res.status(400).json({ error: 'API secret appears to be invalid (too short)' });
        }

        const exchangeService = ExchangeFactory.createExchange(exchange, { apiKey, apiSecret });
        const isValid = await exchangeService.validateCredentials({ apiKey, apiSecret });
        
        if (!isValid) return res.status(400).json({ error: 'Invalid API key or secret. Please check your credentials.' });

        // Check if user already has an API key for this exchange
        const existingKey = await ApiKey.findOne({ user: userId, exchange: exchange.toLowerCase() });
        if (existingKey) {
            return res.status(400).json({ 
                error: `You already have an API key for ${exchange}. Please delete the existing one first or use a different exchange.` 
            });
        }

        // Save the validated API key
        const newApiKey = new ApiKey({
            user: userId,
            exchange: exchange.toLowerCase(),
            apiKey,
            apiSecret,
        });
        await newApiKey.save();
        
        res.status(201).json({ 
            success: true
        });
    } catch (error) {
        res.status(500).json({ error: 'Add api key failed' });
    }
};

export const getApiKeys = async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;
    
        const total = await ApiKey.countDocuments({ user: userId });
    
        const apiKeys = await ApiKey.find({ user: userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
  
        const decryptedKeys = apiKeys.map(key => ({
            _id: key._id,
            exchange: key.exchange,
            apiKey: decrypt(key.apiKey),
            createdAt: key.createdAt,
        }));
    
        res.status(201).json({
            apiKeys: decryptedKeys,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: 'Fetch api keys failed' });
    }
};

export const deleteApiKey = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const keyId = req.params.id;
        
        // Check if API key exists and belongs to user
        const key = await ApiKey.findById(keyId);
        if (!key) return res.status(404).json({ error: 'API key not found' });

        if (key.user.toString() !== userId) return res.status(401).json({ error: 'Not authorized' });
        
        // Check if API key is being used by any bots
        const botsUsingKey = await Bot.find({ 
            user: userId, 
            apiKeyRef: keyId 
        });
        
        if (botsUsingKey.length > 0) {
            const botNames = botsUsingKey.map(bot => bot.name).join(', ');
            return res.status(400).json({ 
                error: `Cannot delete API key. It is being used by the following bots: ${botNames}. Please delete or update these bots first.`,
                botsUsingKey: botsUsingKey.map(bot => ({ 
                    id: bot._id, 
                    name: bot.name, 
                    status: bot.status 
                })),
                canDelete: false
            });
        }
        
        // Additional safety check: ensure no running bots are using this key
        const runningBotsUsingKey = botsUsingKey.filter(bot => bot.status === 'running');
        if (runningBotsUsingKey.length > 0) {
            const botNames = runningBotsUsingKey.map(bot => bot.name).join(', ');
            return res.status(400).json({ 
                error: `Cannot delete API key. It is being used by running bots: ${botNames}. Please stop these bots first.`,
                botsUsingKey: runningBotsUsingKey.map(bot => ({ 
                    id: bot._id, 
                    name: bot.name, 
                    status: bot.status 
                })),
                canDelete: false
            });
        }
        
        // Safe to delete the API key
        await ApiKey.findByIdAndDelete(keyId);
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Delete api key failed' });
    }
};

export const getApiKeyUsage = async (req: Request, res: Response) => {
    try {
        const { error } = idSchema.validate({ id: req.params.id });
        if (error) return res.status(400).json({ error: error.details[0].message });

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        const keyId = req.params.id;
        
        // Check if API key exists and belongs to user
        const key = await ApiKey.findById(keyId);
        if (!key) {
            return res.status(404).json({ error: 'API key not found' });
        }

        if (key.user.toString() !== userId) {
            return res.status(401).json({ error: 'Not authorized' });
        }
        
        // Find bots using this API key
        const botsUsingKey = await Bot.find({ 
            user: userId, 
            apiKeyRef: keyId 
        });
        
        res.status(201).json({ 
            apiKey: {
                _id: key._id,
                exchange: key.exchange,
                apiKey: decrypt(key.apiKey),
                createdAt: key.createdAt,
            },
            botsUsingKey: botsUsingKey.map(bot => ({ 
                id: bot._id, 
                name: bot.name, 
                status: bot.status 
            })),
            canDelete: botsUsingKey.length === 0
        });
    } catch (error) {
        res.status(500).json({ error: 'Get api key usage failed' });
    }
};

export const testApiKey = async (req: Request, res: Response) => {
    try {
        const { error } = addApiKeySchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { exchange, apiKey, apiSecret } = req.body;

        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'Not authorized' });

        // Validate exchange is supported
        const supportedExchanges = ExchangeFactory.getSupportedExchanges();
        if (!supportedExchanges.includes(exchange.toLowerCase())) {
            return res.status(400).json({ 
                error: `Unsupported exchange: ${exchange}. Supported exchanges: ${supportedExchanges.join(', ')}` 
            });
        }

        // Validate API key format (basic validation)
        if (apiKey.length < 10) {
            return res.status(400).json({ error: 'API key appears to be invalid (too short)' });
        }

        if (apiSecret.length < 10) {
            return res.status(400).json({ error: 'API secret appears to be invalid (too short)' });
        }

        // Test the API key with the exchange
        const exchangeService = ExchangeFactory.createExchange(exchange, { apiKey, apiSecret });
        const isValid = await exchangeService.validateCredentials({ apiKey, apiSecret });
        
        if (!isValid) {
            res.status(400).json({ error: 'Invalid API key or secret. Please check your credentials.' });
            return;
        }

        // Get account info to verify permissions and provide additional info
        let accountInfo = null;
        let balances = null;
        accountInfo = await exchangeService.getAccountInfo();
        balances = await exchangeService.getBalance();
        
        // Filter to show only assets with non-zero balances
        const nonZeroBalances = balances.filter((balance: any) => balance.total > 0);
        
        res.status(201).json({ 
            exchange: exchange.toLowerCase(),
            accountInfo: {
                makerCommission: accountInfo.makerCommission,
                takerCommission: accountInfo.takerCommission,
                canTrade: accountInfo.canTrade,
                canWithdraw: accountInfo.canWithdraw,
                canDeposit: accountInfo.canDeposit,
            },
            balances: nonZeroBalances.slice(0, 10), // Show first 10 non-zero balances
            totalAssets: nonZeroBalances.length
        });
    } catch (error) {
        res.status(500).json({ error: 'Test api key failed' });
    }
}; 