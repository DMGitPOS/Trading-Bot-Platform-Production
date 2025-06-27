"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendContactUsEmail = exports.sendResetPasswordEmail = exports.sendVerificationEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const sendEmail = async (to, subject, htmlTemplate) => {
    const transporter = nodemailer_1.default.createTransport({
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
const sendVerificationEmail = async (to, verificationUrl) => {
    try {
        const subject = "Email Verification";
        const templateFilePath = path_1.default.join(__dirname, "/../emailTemplate/email-verification.html");
        const year = new Date().getFullYear();
        const htmlTemplate = getHtmlTemplateWithData(templateFilePath, { verificationUrl, year });
        await sendEmail(to, subject, htmlTemplate);
    }
    catch (error) {
        console.error("Error in sending verification email:", error);
        throw new Error("Failed to send verification email");
    }
};
exports.sendVerificationEmail = sendVerificationEmail;
const sendResetPasswordEmail = async (to, verificationUrl) => {
    try {
        const subject = "Reset Password";
        const templateFilePath = path_1.default.join(__dirname, "/../emailTemplate/password-reset.html");
        const year = new Date().getFullYear();
        const htmlTemplate = getHtmlTemplateWithData(templateFilePath, { verificationUrl, year });
        await sendEmail(to, subject, htmlTemplate);
    }
    catch (error) {
        console.error("Error in sending reset password email:", error);
        throw new Error("Failed to send reset password email");
    }
};
exports.sendResetPasswordEmail = sendResetPasswordEmail;
const sendContactUsEmail = async (name, email, message) => {
    try {
        const subject = "New Contact Us Message";
        const templateFilePath = path_1.default.join(__dirname, "/../emailTemplate/contact-us.html");
        const year = new Date().getFullYear();
        const htmlTemplate = getHtmlTemplateWithData(templateFilePath, { name, email, message, year });
        const to = process.env.CONTACT_EMAIL;
        if (!to)
            throw new Error("CONTACT_EMAIL environment variable not set");
        await sendEmail(to, subject, htmlTemplate);
    }
    catch (error) {
        console.error("Error in sending contact us email:", error);
        throw new Error("Failed to send contact us email");
    }
};
exports.sendContactUsEmail = sendContactUsEmail;
const getHtmlTemplateWithData = (templateFilePath, data) => {
    try {
        const resolvedPath = path_1.default.resolve(templateFilePath);
        if (!fs_1.default.existsSync(resolvedPath)) {
            throw new Error(`Template file not found at ${resolvedPath}`);
        }
        let template = fs_1.default.readFileSync(resolvedPath, { encoding: "utf8" });
        for (const [key, value] of Object.entries(data)) {
            const placeholder = new RegExp(`\\{${key}\\}`, "g");
            template = template.replace(placeholder, value.toString());
        }
        return template;
    }
    catch (error) {
        console.error("Error processing template:", error);
        throw new Error("Failed to process HTML template");
    }
};
//# sourceMappingURL=email.service.js.map