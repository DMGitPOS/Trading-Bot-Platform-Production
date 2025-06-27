import { Request, Response } from 'express';
export declare const createBot: (req: Request, res: Response) => Promise<void>;
export declare const listBots: (req: Request, res: Response) => Promise<void>;
export declare const updateBot: (req: Request, res: Response) => Promise<void>;
export declare const deleteBot: (req: Request, res: Response) => Promise<void>;
export declare const toggleBot: (req: Request, res: Response) => Promise<void>;
export declare const getBotLogs: (req: Request, res: Response) => Promise<void>;
export declare const getBotPerformance: (req: Request, res: Response) => Promise<void>;
