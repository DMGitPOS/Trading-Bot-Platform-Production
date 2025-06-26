import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import passport from './config/passport';
import errorHandler from './middleware/errorHandler';
import authRoutes from './routes/auth';
import apiKeyRoutes from './routes/apiKeys';
import subscriptionRoutes from './routes/subscription';
import botsRoutes from './routes/bots';

const app = express();

// Redirect URLs with trailing slash to no trailing slash (except root)
app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    const query = req.url.slice(req.path.length);
    res.redirect(301, req.path.slice(0, -1) + query);
  } else {
    next();
  }
});

app.use(cors());

const staticPath = path.join(__dirname, 'static');
app.use(express.static(staticPath));

// Handle Stripe webhook raw body
app.use((req, res, next) => {
  if (req.originalUrl === '/api/subscription/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

app.use(session({ secret: process.env.SESSION_SECRET || 'your_secret', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', authRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/bots', botsRoutes);

app.use(errorHandler);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

export default app; 