import { Request, Response } from 'express';
export declare const addApiKey: (req: Request, res: Response) => Promise<void>;
export declare const getApiKeys: (req: Request, res: Response) => Promise<void>;
export declare const deleteApiKey: (req: Request, res: Response) => Promise<void>;
