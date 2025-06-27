export declare const sendVerificationEmail: (to: string, verificationUrl: string) => Promise<void>;
export declare const sendResetPasswordEmail: (to: string, verificationUrl: string) => Promise<void>;
export declare const sendContactUsEmail: (name: string, email: string, message: string) => Promise<void>;
