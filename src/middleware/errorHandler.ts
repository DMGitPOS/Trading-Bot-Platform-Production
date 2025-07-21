import { Request, Response, NextFunction } from 'express';

interface CustomError extends Error {
    statusCode?: number;
}

const errorHandler = (err: CustomError, req: Request, res: Response, next: NextFunction): void => {
    console.error(err.stack);
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Something went wrong on the server';
    res.status(statusCode).json({
        success: false,
        message,
    });
};

export default errorHandler; 