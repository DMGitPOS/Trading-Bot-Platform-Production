import mongoose from 'mongoose';
import Trade from '../models/Trade';

export async function seedMockTrades(userId: mongoose.Types.ObjectId | string): Promise<void> {
  const now = new Date();
  const mockTrades = [
    {
      user: userId,
      symbol: 'BTCUSDT',
      side: 'buy' as const,
      quantity: 0.01,
      price: 60000,
      timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 24),
      status: 'filled' as const,
      exchange: 'Binance',
    },
    {
      user: userId,
      symbol: 'ETHUSDT',
      side: 'sell' as const,
      quantity: 0.5,
      price: 3000,
      timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 12),
      status: 'filled' as const,
      exchange: 'Coinbase',
    },
    {
      user: userId,
      symbol: 'AAPL',
      side: 'buy' as const,
      quantity: 10,
      price: 150,
      timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 6),
      status: 'pending' as const,
      exchange: 'Robinhood',
    },
  ];
  await Trade.insertMany(mockTrades);
}

if (require.main === module) {
  (async () => {
    const userId = process.argv[2];
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/trading-platform';
    if (!userId) {
      console.error('Usage: ts-node src/utils/seedMockTrades.ts <userId>');
      process.exit(1);
    }
    await mongoose.connect(mongoUri);
    await seedMockTrades(userId);
    console.log('Mock trades seeded for user:', userId);
    await mongoose.disconnect();
    process.exit(0);
  })();
} 