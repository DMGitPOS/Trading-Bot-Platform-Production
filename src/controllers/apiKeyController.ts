import { Request, Response } from 'express';
import ApiKey from '../models/ApiKey';
import Bot from '../models/Bot';
import { decrypt } from '../utils/crypto';
import { ExchangeFactory } from '../services/exchange/ExchangeFactory';

export const addApiKey = async (req: Request, res: Response): Promise<void> => {
  try {
    const { exchange, apiKey, apiSecret } = req.body;
    const userId = (req.user as { id: string })?.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }
    if (!exchange || !apiKey || !apiSecret) {
      res.status(400).json({ message: 'Please provide exchange, API key, and secret' });
      return;
    }

    // Validate exchange is supported
    const supportedExchanges = ExchangeFactory.getSupportedExchanges();
    if (!supportedExchanges.includes(exchange.toLowerCase())) {
      res.status(400).json({ 
        message: `Unsupported exchange: ${exchange}. Supported exchanges: ${supportedExchanges.join(', ')}` 
      });
      return;
    }

    // Validate API key format (basic validation)
    if (apiKey.length < 10) {
      res.status(400).json({ message: 'API key appears to be invalid (too short)' });
      return;
    }

    if (apiSecret.length < 10) {
      res.status(400).json({ message: 'API secret appears to be invalid (too short)' });
      return;
    }

    // Test the API key with the exchange
    try {
      const exchangeService = ExchangeFactory.createExchange(exchange, { apiKey, apiSecret });
      const isValid = await exchangeService.validateCredentials({ apiKey, apiSecret });
      
      if (!isValid) {
        res.status(400).json({ message: 'Invalid API key or secret. Please check your credentials.' });
        return;
      }

      // Optional: Get account info to verify permissions
      try {
        const accountInfo = await exchangeService.getAccountInfo();
        console.log(`API key validated successfully for user ${userId} on ${exchange}`);
      } catch (accountError) {
        console.warn(`API key validated but couldn't fetch account info:`, accountError);
        // Don't fail here, as the key might be valid but have limited permissions
      }

    } catch (validationError) {
      console.error('API key validation error:', validationError);
      res.status(400).json({ 
        message: 'Failed to validate API key. Please check your credentials and try again.' 
      });
      return;
    }

    // Check if user already has an API key for this exchange
    const existingKey = await ApiKey.findOne({ user: userId, exchange: exchange.toLowerCase() });
    if (existingKey) {
      res.status(400).json({ 
        message: `You already have an API key for ${exchange}. Please delete the existing one first or use a different exchange.` 
      });
      return;
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
      message: 'API key added and validated successfully',
      exchange: exchange.toLowerCase()
    });
  } catch (error) {
    console.error('Error in addApiKey:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getApiKeys = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string })?.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }
    const apiKeys = await ApiKey.find({ user: userId });
    const decryptedKeys = apiKeys.map(key => ({
      _id: key._id,
      exchange: key.exchange,
      apiKey: decrypt(key.apiKey),
      createdAt: key.createdAt,
    }));
    res.status(200).json(decryptedKeys);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deleteApiKey = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string })?.id;
    const keyId = req.params.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }
    
    // Check if API key exists and belongs to user
    const key = await ApiKey.findById(keyId);
    if (!key) {
      res.status(404).json({ message: 'API key not found' });
      return;
    }
    if (key.user.toString() !== userId) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }
    
    // Check if API key is being used by any bots
    const botsUsingKey = await Bot.find({ 
      user: userId, 
      apiKeyRef: keyId 
    });
    
    if (botsUsingKey.length > 0) {
      const botNames = botsUsingKey.map(bot => bot.name).join(', ');
      res.status(400).json({ 
        message: `Cannot delete API key. It is being used by the following bots: ${botNames}. Please delete or update these bots first.`,
        botsUsingKey: botsUsingKey.map(bot => ({ 
          id: bot._id, 
          name: bot.name, 
          status: bot.status 
        })),
        canDelete: false
      });
      return;
    }
    
    // Additional safety check: ensure no running bots are using this key
    const runningBotsUsingKey = botsUsingKey.filter(bot => bot.status === 'running');
    if (runningBotsUsingKey.length > 0) {
      const botNames = runningBotsUsingKey.map(bot => bot.name).join(', ');
      res.status(400).json({ 
        message: `Cannot delete API key. It is being used by running bots: ${botNames}. Please stop these bots first.`,
        botsUsingKey: runningBotsUsingKey.map(bot => ({ 
          id: bot._id, 
          name: bot.name, 
          status: bot.status 
        })),
        canDelete: false
      });
      return;
    }
    
    // Safe to delete the API key
    await ApiKey.findByIdAndDelete(keyId);
    res.status(200).json({ message: 'API key deleted successfully' });
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getApiKeyUsage = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string })?.id;
    const keyId = req.params.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }
    
    // Check if API key exists and belongs to user
    const key = await ApiKey.findById(keyId);
    if (!key) {
      res.status(404).json({ message: 'API key not found' });
      return;
    }
    if (key.user.toString() !== userId) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }
    
    // Find bots using this API key
    const botsUsingKey = await Bot.find({ 
      user: userId, 
      apiKeyRef: keyId 
    });
    
    res.status(200).json({ 
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
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const testApiKey = async (req: Request, res: Response): Promise<void> => {
  try {
    const { exchange, apiKey, apiSecret } = req.body;
    const userId = (req.user as { id: string })?.id;
    if (!userId) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }
    if (!exchange || !apiKey || !apiSecret) {
      res.status(400).json({ message: 'Please provide exchange, API key, and secret' });
      return;
    }

    // Validate exchange is supported
    const supportedExchanges = ExchangeFactory.getSupportedExchanges();
    if (!supportedExchanges.includes(exchange.toLowerCase())) {
      res.status(400).json({ 
        message: `Unsupported exchange: ${exchange}. Supported exchanges: ${supportedExchanges.join(', ')}` 
      });
      return;
    }

    // Validate API key format (basic validation)
    if (apiKey.length < 10) {
      res.status(400).json({ message: 'API key appears to be invalid (too short)' });
      return;
    }

    if (apiSecret.length < 10) {
      res.status(400).json({ message: 'API secret appears to be invalid (too short)' });
      return;
    }

    // Test the API key with the exchange
    try {
      const exchangeService = ExchangeFactory.createExchange(exchange, { apiKey, apiSecret });
      const isValid = await exchangeService.validateCredentials({ apiKey, apiSecret });
      
      if (!isValid) {
        res.status(400).json({ message: 'Invalid API key or secret. Please check your credentials.' });
        return;
      }

      // Get account info to verify permissions and provide additional info
      let accountInfo = null;
      let balances = null;
      try {
        accountInfo = await exchangeService.getAccountInfo();
        balances = await exchangeService.getBalance();
        
        // Filter to show only assets with non-zero balances
        const nonZeroBalances = balances.filter((balance: any) => balance.total > 0);
        
        res.status(200).json({ 
          message: 'API key is valid and working',
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
      } catch (accountError) {
        console.warn(`API key validated but couldn't fetch account info:`, accountError);
        res.status(200).json({ 
          message: 'API key is valid but has limited permissions',
          exchange: exchange.toLowerCase(),
          note: 'Could not fetch account information. The key might have restricted permissions.'
        });
      }

    } catch (validationError) {
      console.error('API key validation error:', validationError);
      res.status(400).json({ 
        message: 'Failed to validate API key. Please check your credentials and try again.' 
      });
    }
  } catch (error) {
    console.error('Error in testApiKey:', error);
    res.status(500).json({ message: 'Server error' });
  }
}; 