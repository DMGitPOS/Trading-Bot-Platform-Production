import Notification from "../../models/Notification";
import NotificationPreference from "../../models/NotificationPreference";
import User from "../../models/User";
import { sendTelegramMessage } from './telegram.service';
import { sendDiscordMessage } from './discord.service';
import { sendSMS } from './sms.service';
import { sendEmail } from '../email.service';

interface NotifyUserOptions {
    userId: string;
    type: string;
    message: string;
    botName?: string;
}

/**
 * Store a notification and send to all enabled channels for a user
 */
export async function notifyUser(options: NotifyUserOptions): Promise<void> {
    const { userId, type, message, botName } = options;

    // 1. Store notification in DB
    await Notification.create({
        user: userId,
        type,
        message,
        botName,
        timestamp: new Date(),
    });

    // 2. Fetch preferences and user info
    const [pref, user] = await Promise.all([
        NotificationPreference.findOne({ user: userId }),
        User.findById(userId),
    ]);
    if (!pref || !user) return;

    // 3. Send via enabled channels
    const promises: Promise<void>[] = [];

    if (pref.email && user.email) {
        promises.push(
            sendEmail(
                user.email,
                'Trading Bot Notification',
                `<p>${message}</p>`
            )
        );
    }
    if (pref.telegram && pref.telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
        promises.push(
            sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, pref.telegramChatId, message)
        );
    }
    if (pref.discord && pref.discordWebhook) {
        promises.push(
            sendDiscordMessage(pref.discordWebhook, message)
        );
    }
    if (pref.sms && pref.smsNumber && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
        promises.push(
            sendSMS(
                process.env.TWILIO_ACCOUNT_SID,
                process.env.TWILIO_AUTH_TOKEN,
                process.env.TWILIO_FROM_NUMBER,
                pref.smsNumber,
                message
            )
        );
    }

  await Promise.all(promises);
} 