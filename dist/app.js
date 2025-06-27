"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const express_session_1 = __importDefault(require("express-session"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
const passport_1 = __importDefault(require("./config/passport"));
const errorHandler_1 = __importDefault(require("./middleware/errorHandler"));
const auth_1 = __importDefault(require("./routes/auth"));
const apiKeys_1 = __importDefault(require("./routes/apiKeys"));
const subscription_1 = __importDefault(require("./routes/subscription"));
const bots_1 = __importDefault(require("./routes/bots"));
const app = (0, express_1.default)();
// Redirect URLs with trailing slash to no trailing slash (except root)
app.use((req, res, next) => {
    if (req.path.length > 1 && req.path.endsWith('/')) {
        const query = req.url.slice(req.path.length);
        res.redirect(301, req.path.slice(0, -1) + query);
    }
    else {
        next();
    }
});
app.use((0, cors_1.default)());
const staticPath = path_1.default.join(__dirname, 'static');
app.use(express_1.default.static(staticPath));
// Handle Stripe webhook raw body
app.use((req, res, next) => {
    if (req.originalUrl === '/api/subscription/webhook') {
        next();
    }
    else {
        express_1.default.json()(req, res, next);
    }
});
app.use((0, express_session_1.default)({ secret: process.env.SESSION_SECRET || 'your_secret', resave: false, saveUninitialized: false }));
app.use(passport_1.default.initialize());
app.use(passport_1.default.session());
app.use('/api/auth', auth_1.default);
app.use('/api/keys', apiKeys_1.default);
app.use('/api/subscription', subscription_1.default);
app.use('/api/bots', bots_1.default);
app.use(errorHandler_1.default);
app.get('*', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, 'static', 'index.html'));
});
exports.default = app;
//# sourceMappingURL=app.js.map