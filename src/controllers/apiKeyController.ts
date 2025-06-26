import { Request, Response } from 'express';
import ApiKey from '../models/ApiKey';
import { decrypt } from '../utils/crypto';

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
    const newApiKey = new ApiKey({
      user: userId,
      exchange,
      apiKey,
      apiSecret,
    });
    await newApiKey.save();
    res.status(201).json({ message: 'API key added successfully' });
  } catch (error) {
    console.error('Error in addApiKey:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getApiKeys = async (req: Request, res: Response): Promise<void> => {
  console.log('getApiKeys');
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
    const key = await ApiKey.findById(keyId);
    if (!key) {
      res.status(404).json({ message: 'API key not found' });
      return;
    }
    if (key.user.toString() !== userId) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }
    await ApiKey.findByIdAndDelete(keyId);
    res.status(200).json({ message: 'API key deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
}; 