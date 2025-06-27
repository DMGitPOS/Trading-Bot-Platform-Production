import { Request, Response, NextFunction } from 'express';
declare const auth: (req: Request, res: Response, next: NextFunction) => void;
export default auth;
