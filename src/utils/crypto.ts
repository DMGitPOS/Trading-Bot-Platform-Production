import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex");
const IV_LENGTH = 16;
const IV = Buffer.from(process.env.ENCRYPTION_IV || "0123456789abcdef0123456789abcdef", "hex");

export function encrypt(text: string): string {
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, IV);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

export function decrypt(encryptedText: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, IV);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
} 