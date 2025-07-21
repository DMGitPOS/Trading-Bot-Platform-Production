import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import crypto from 'crypto';

export interface TwoFactorSecret {
    secret: string;
    otpauth_url: string;
    qrcode: string;
}

export class TwoFactorAuthService {
    /**
     * Generate a new secret for 2FA setup
     * @param email User's email for labeling the 2FA
     * @returns Promise with secret details
     */
    public static async generateSecret(email: string): Promise<TwoFactorSecret> {
        const secretCode = speakeasy.generateSecret({
            name: `Trading Bot Platform:${email}`,
            issuer: 'Trading Bot Platform'
        });

        const otpauthUrl = secretCode.otpauth_url;
        if (!otpauthUrl) {
            throw new Error('Failed to generate OTP auth URL');
        }

        const qrcode = await QRCode.toDataURL(otpauthUrl);

        return {
            secret: secretCode.base32,
            otpauth_url: otpauthUrl,
            qrcode: qrcode
        };
    }

    /**
     * Verify a 2FA token
     * @param secret The user's 2FA secret
     * @param token The token to verify
     * @returns boolean indicating if token is valid
     */
    public static verifyToken(secret: string, token: string): boolean {
        try {
            return speakeasy.totp.verify({
                secret: secret,
                encoding: 'base32',
                token: token,
                window: 1 // Allow 30 seconds window
            });
        } catch (error) {
            console.error('2FA verification error:', error);
            return false;
        }
    }

    /**
     * Generate backup codes for 2FA recovery
     * @param count Number of backup codes to generate
     * @returns Array of hashed backup codes and their plain text versions
     */
    public static generateBackupCodes(count: number = 8): { 
        hashedCodes: string[], 
        plainCodes: string[] 
    } {
        const codes: string[] = [];
        const hashedCodes: string[] = [];

        for (let i = 0; i < count; i++) {
            // Generate a random 8-character code
            const code = crypto.randomBytes(4).toString('hex').toUpperCase();
            codes.push(code);
            
            // Hash the code for storage
            const hashedCode = crypto
                .createHash('sha256')
                .update(code)
                .digest('hex');
            
            hashedCodes.push(hashedCode);
        }

        return {
            hashedCodes,
            plainCodes: codes
        };
    }

    /**
     * Verify a backup code
     * @param providedCode The backup code provided by the user
     * @param hashedCodes Array of hashed backup codes
     * @returns The index of the matched code or -1 if no match
     */
    public static verifyBackupCode(providedCode: string, hashedCodes: string[]): number {
        const hashedProvidedCode = crypto
            .createHash('sha256')
            .update(providedCode.toUpperCase())
            .digest('hex');

        return hashedCodes.findIndex(code => code === hashedProvidedCode);
    }

    /**
     * Generate a QR code for the given secret
     * @param secret The 2FA secret
     * @param email User's email
     * @returns Promise with QR code data URL
     */
    public static async generateQRCode(secret: string, email: string): Promise<string> {
        const otpauthUrl = speakeasy.otpauthURL({
            secret: secret,
            label: `Trading Bot Platform:${email}`,
            issuer: 'Trading Bot Platform',
            encoding: 'base32'
        });

        return QRCode.toDataURL(otpauthUrl);
    }
}