"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const app_1 = __importDefault(require("./app"));
dotenv_1.default.config();
const PORT = Number(process.env.PORT) || 5000;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error('MONGODB_URI is not defined in the environment variables.');
    process.exit(1);
}
mongoose_1.default
    .connect(MONGO_URI)
    .then(() => {
    console.log(`Connected to MongoDB: ${MONGO_URI}`);
    app_1.default.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });
})
    .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map