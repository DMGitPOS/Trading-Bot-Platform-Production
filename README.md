# Backend3

This project is a cloud-ready backend, structured like backend2 but containing only the logic from backend1. It uses strict TypeScript (no `any` types), is ready for deployment, and includes features such as authentication, API key management, bot management, and Stripe-based subscriptions.

## Features
- User authentication (JWT, Google OAuth)
- Email verification and password reset
- API key management
- Bot management (CRUD, logs, performance)
- Subscription management (Stripe)
- User profile and trade history
- Strict TypeScript (no `any` types)

## Getting Started
1. Install dependencies: `npm install`
2. Set up your `.env` file (see `.env.example`)
3. Run in development: `npm run dev`
4. Build for production: `npm run build`
5. Start in production: `npm start`

## Cloud Deployment
- Binds to `0.0.0.0` for cloud compatibility
- Uses environment variables for all secrets and configuration

## License
MIT 