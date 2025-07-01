import mongoose from 'mongoose';
import dotenv from 'dotenv';
import app from './app';
import Bot from './models/Bot';
import { startBotJob } from './services/botScheduler';

dotenv.config();

const PORT = Number(process.env.PORT) || 5000;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('MONGODB_URI is not defined in the environment variables.');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log(`Connected to MongoDB: ${MONGO_URI}`);
    // Auto-start jobs for all running bots
    const runningBots = await Bot.find({ status: 'running' });
    let scheduledCount = 0;
    for (const bot of runningBots) {
      try {
        await startBotJob((bot._id as mongoose.Types.ObjectId).toString());
        scheduledCount++;
      } catch (err) {
        console.error(`Failed to schedule bot ${(bot._id as mongoose.Types.ObjectId).toString()}:`, err);
      }
    }
    console.log(`Scheduled ${scheduledCount} running bot(s) on startup.`);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err: unknown) => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }); 