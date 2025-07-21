import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import dotenv from 'dotenv';
import fileUpload from 'express-fileupload';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import passport from './config/passport';
import routes from './routes';
import errorHandler from './middleware/errorHandler';

const app = express();

// Redirect URLs with trailing slash to no trailing slash (except root)
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.length > 1 && req.path.endsWith('/')) {
        const query: string = req.url.slice(req.path.length);
        res.redirect(301, req.path.slice(0, -1) + query);
    } else {
        next();
    }
});

app.use(cors());

const staticPath: string = path.join(__dirname, 'static');
app.use(express.static(staticPath));

app.use(
    fileUpload({
        createParentPath: true,
        limits: {
            fileSize: 100 * 1024 * 1024,
        },
        abortOnLimit: true,
        safeFileNames: false,
        preserveExtension: true,
    })
);

// Handle Stripe webhook raw body
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.originalUrl === '/api/subscription/webhook') {
        next();
    } else {
        express.json()(req, res, next);
    }
});

app.use(
    session({
        secret: process.env.SESSION_SECRET || 'your_secret',
        resave: false,
        saveUninitialized: false,
    })
);
app.use(passport.initialize());
app.use(passport.session());

app.use('/api', routes);

app.use(errorHandler);

app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

export default app;
