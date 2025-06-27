"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = "aes-256-cbc";
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex");
const IV_LENGTH = 16;
const IV = Buffer.from(process.env.ENCRYPTION_IV || "0123456789abcdef0123456789abcdef", "hex");
function encrypt(text) {
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, ENCRYPTION_KEY, IV);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
}
function decrypt(encryptedText) {
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, IV);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
//# sourceMappingURL=crypto.js.map