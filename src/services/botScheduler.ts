import cron, { ScheduledTask } from 'node-cron';
import Bot, { IBot } from '../models/Bot';
import ApiKey, { IApiKey } from '../models/ApiKey';
import { runBot } from './botRunner';
import BotLog from '../models/BotLog';

// In-memory job tracking (for production, persist in DB or use a distributed queue)
const jobs: Record<string, ScheduledTask> = {};

export async function startBotJob(botId: string) {
  // Prevent duplicate jobs
  if (jobs[botId]) return;
  // Fetch bot and API key
  const bot = await Bot.findById(botId) as IBot;
  if (!bot) throw new Error('Bot not found');
  const apiKey = await ApiKey.findById(bot.apiKeyRef) as IApiKey;
  if (!apiKey) throw new Error('API key not found');
  // Schedule job every minute
  const task = cron.schedule('* * * * *', async () => {
    try {
      await runBot(bot, apiKey);
      // Log successful run
      await BotLog.create({
        bot: bot._id,
        timestamp: new Date(),
        type: 'info',
        message: 'Bot executed successfully',
      });
    } catch (err) {
      // Log error to BotLog
      await BotLog.create({
        bot: bot._id,
        timestamp: new Date(),
        type: 'error',
        message: 'Bot execution error',
        data: { error: (err as Error).message },
      });
      console.error(`Bot ${botId} error:`, err);
    }
  });
  jobs[botId] = task;
}

export function stopBotJob(botId: string) {
  const job = jobs[botId];
  if (job) {
    job.stop();
    delete jobs[botId];
  }
} 