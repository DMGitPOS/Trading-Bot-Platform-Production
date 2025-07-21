import twilio from "twilio";

export async function sendSMS(
    accountSid: string,
    authToken: string,
    from: string,
    to: string,
    message: string
): Promise<void> {
    const client = twilio(accountSid, authToken);
    try {
        await client.messages.create({
            body: message,
            from,
            to,
        });
    } catch (error) {
        console.error("Failed to send SMS:", error);
        throw error;
    }
}
