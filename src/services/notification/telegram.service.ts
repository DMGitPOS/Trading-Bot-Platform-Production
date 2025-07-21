import axios from "axios";

export async function sendTelegramMessage(botToken: string, chatId: string, message: string): Promise<void> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: "Markdown",
        });
    } catch (error) {
        console.error("Failed to send Telegram message:", error);
        throw error;
    }
}
