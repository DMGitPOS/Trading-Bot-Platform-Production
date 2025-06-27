import { Request, Response, NextFunction } from 'express';
interface CustomError extends Error {
    statusCode?: number;
}
declare const errorHandler: (err: CustomError, req: Request, res: Response, next: NextFunction) => void;
export default errorHandler;
