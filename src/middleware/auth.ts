import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'default_jwt_secret';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
    };
}

export const authenticateJWT = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization header missing or malformed' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET_KEY) as { id: string; email: string };
        (req as AuthRequest).user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

export const isAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as AuthRequest).user?.id;
        if (!userId) return res.status(401).json({ error: 'User not authenticated' });
        const user = await User.findById(userId);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    } catch (err) {
        return res.status(500).json({ error: 'Failed to check admin role' });
    }
};
