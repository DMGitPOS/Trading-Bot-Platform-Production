import { Request, Response } from 'express';
export declare const createCheckoutSession: (req: Request, res: Response) => Promise<void>;
export declare const handleWebhook: (req: Request, res: Response) => Promise<void>;
export declare const createPortalSession: (req: Request, res: Response) => Promise<void>;
