import axios from "axios";

/**
 * Send a message to a Discord channel via webhook
 * @param webhookUrl Discord webhook URL
 * @param message Message content
 */
export async function sendDiscordMessage(webhookUrl: string, message: string): Promise<void> {
    try {
        await axios.post(webhookUrl, {
            content: message,
        });
    } catch (error) {
        console.error("Failed to send Discord message:", error);
        throw error;
    }
}
