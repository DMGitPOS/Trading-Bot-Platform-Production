import nodemailer from "nodemailer";
import path from "path";
import fs from "fs";

interface TemplateData {
    verificationUrl?: string;
    name?: string;
    email?: string;
    message?: string;
    year?: string | number;
}

const sendEmail = async (to: string, subject: string, htmlTemplate: string): Promise<void> => {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 465,
        secure: true,
        auth: {
          user: process.env.SMTP_EMAIL,
          pass: process.env.SMTP_PASSWORD,
        },
        tls: {
            rejectUnauthorized: false,
        },
    });

    await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to,
        subject,
        html: htmlTemplate
    });
};

export const sendVerificationEmail = async (to: string, verificationUrl: string): Promise<void> => {
    try {
        const subject = "Email Verification";
        
        const templateFilePath = path.join(
            __dirname,
            "/../emailTemplate/email-verification.html"
        );
        const year = new Date().getFullYear();
        const htmlTemplate = getHtmlTemplateWithData(
            templateFilePath,
            { verificationUrl, year }
        );

        await sendEmail(to, subject, htmlTemplate);
    } catch (error) {
        console.error("Error in sending verification email:", error);
        throw new Error("Failed to send verification email");
    }
};

export const sendResetPasswordEmail = async (to: string, verificationUrl: string): Promise<void> => {
    try {
        const subject = "Reset Password";
        
        const templateFilePath = path.join(
            __dirname,
            "/../emailTemplate/password-reset.html"
        );
        const year = new Date().getFullYear();
        const htmlTemplate = getHtmlTemplateWithData(
            templateFilePath,
            { verificationUrl , year }
        );

        await sendEmail(to, subject, htmlTemplate);
    } catch (error) {
        console.error("Error in sending reset password email:", error);
        throw new Error("Failed to send reset password email");
    }
};

export const sendContactUsEmail = async (name: string, email: string, message: string): Promise<void> => {
    try {
        const subject = "New Contact Us Message";
        const templateFilePath = path.join(
            __dirname,
            "/../emailTemplate/contact-us.html"
        );
        const year = new Date().getFullYear();
        const htmlTemplate = getHtmlTemplateWithData(
            templateFilePath,
            { name, email, message, year }
        );
        const to = process.env.CONTACT_EMAIL;
        if (!to) throw new Error("CONTACT_EMAIL environment variable not set");
        await sendEmail(to, subject, htmlTemplate);
    } catch (error) {
        console.error("Error in sending contact us email:", error);
        throw new Error("Failed to send contact us email");
    }
};

const getHtmlTemplateWithData = (templateFilePath: string, data: TemplateData): string => {
    try {
        const resolvedPath = path.resolve(templateFilePath);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Template file not found at ${resolvedPath}`);
        }

        let template = fs.readFileSync(resolvedPath, { encoding: "utf8" });

        for (const [key, value] of Object.entries(data)) {
            const placeholder = new RegExp(`\\{${key}\\}`, "g");
            template = template.replace(placeholder, value.toString());
        }

        return template;
    } catch (error) {
        console.error("Error processing template:", error);
        throw new Error("Failed to process HTML template");
    }
}