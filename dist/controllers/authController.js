"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePassword = exports.updateProfile = exports.getUserTrades = exports.googleAuthCallback = exports.getMe = exports.resetPassword = exports.forgotPassword = exports.verifyEmail = exports.login = exports.register = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = __importDefault(require("../models/User"));
const crypto_1 = __importDefault(require("crypto"));
const Trade_1 = __importDefault(require("../models/Trade"));
const frontend = process.env.FRONTEND;
const JWT_SECRET = process.env.JWT_SECRET || "secret";
const sendEmail = async (to, subject, text) => {
    console.log(`Email to ${to}: ${subject}\n${text}`);
};
const register = async (req, res) => {
    const { email, password, name } = req.body;
    const existingUser = await User_1.default.findOne({ email });
    if (existingUser) {
        res.status(400).json({ message: "User already exists" });
        return;
    }
    const hashedPassword = await bcryptjs_1.default.hash(password, 10);
    const emailVerificationToken = crypto_1.default.randomBytes(32).toString("hex");
    const user = new User_1.default({
        email,
        password: hashedPassword,
        name,
        emailVerificationToken,
    });
    await user.save();
    const verificationLink = `${frontend}/auth/verify-email?email=${encodeURIComponent(email)}&token=${emailVerificationToken}`;
    // await sendVerificationEmail(email, verificationLink);
    console.log(`Verification link: ${verificationLink}`);
    res
        .status(201)
        .json({ message: "User registered. Please verify your email." });
};
exports.register = register;
const login = async (req, res) => {
    const { email, password } = req.body;
    const user = await User_1.default.findOne({ email });
    if (!user || !user.password) {
        res.status(400).json({ message: "Invalid credentials" });
        return;
    }
    if (!password) {
        res.status(400).json({ message: "Password is required" });
        return;
    }
    const isMatch = await bcryptjs_1.default.compare(password, user.password);
    if (!isMatch) {
        res.status(400).json({ message: "Invalid credentials" });
        return;
    }
    if (!user.isEmailVerified) {
        res.status(403).json({ message: "Email not verified" });
        return;
    }
    const token = jsonwebtoken_1.default.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1d" });
    res.json({
        token,
        user: {
            email: user.email,
            name: user.name,
            subscriptionStatus: user.subscriptionStatus,
            subscriptionPlan: user.subscriptionPlan,
            hasPassword: !!user.password,
        },
    });
};
exports.login = login;
const verifyEmail = async (req, res) => {
    const { email, token } = req.body;
    const user = await User_1.default.findOne({ email });
    if (!user || user.emailVerificationToken !== token) {
        res.status(400).json({ message: "Invalid token" });
        return;
    }
    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();
    res.json({ message: "Email verified" });
};
exports.verifyEmail = verifyEmail;
const forgotPassword = async (req, res) => {
    const { email } = req.body;
    const user = await User_1.default.findOne({ email });
    if (!user) {
        res.status(400).json({ message: "User not found" });
        return;
    }
    const resetToken = crypto_1.default.randomBytes(32).toString("hex");
    user.resetPasswordToken = resetToken;
    await user.save();
    const resetLink = `${frontend}/auth/reset-password?email=${encodeURIComponent(email)}&token=${resetToken}`;
    await sendEmail(email, "Reset your password", `Click the link to reset: ${resetLink}\nOr use this token: ${resetToken}`);
    console.log(`Password reset link: ${resetLink}`);
    res.json({ message: "Password reset email sent" });
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res) => {
    const { email, token, newPassword } = req.body;
    const user = await User_1.default.findOne({ email });
    if (!user || user.resetPasswordToken !== token) {
        res.status(400).json({ message: "Invalid token" });
        return;
    }
    user.password = await bcryptjs_1.default.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    await user.save();
    res.json({ message: "Password reset successful" });
};
exports.resetPassword = resetPassword;
const getMe = async (req, res) => {
    const userId = req.user?.id;
    const userWithPassword = await User_1.default.findById(userId).select("password");
    if (!userWithPassword) {
        res.status(404).json({ message: "User not found" });
        return;
    }
    const user = await User_1.default.findById(userId).select("-password -emailVerificationToken -resetPasswordToken -twoFASecret");
    if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
    }
    res.json({
        user: {
            email: user.email,
            name: user.name,
            subscriptionStatus: user.subscriptionStatus,
            subscriptionPlan: user.subscriptionPlan,
            hasPassword: !!userWithPassword.password,
        },
    });
};
exports.getMe = getMe;
const googleAuthCallback = async (req, res) => {
    const user = req.user;
    if (!user) {
        res.status(401).json({ message: "Google authentication failed" });
        return;
    }
    const token = jsonwebtoken_1.default.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1d" });
    const frontendUrl = process.env.FRONTEND;
    res.redirect(`${frontendUrl}/auth?token=${token}`);
};
exports.googleAuthCallback = googleAuthCallback;
const getUserTrades = async (req, res) => {
    const userId = req.user?.id;
    const trades = await Trade_1.default.find({ user: userId }).sort({ timestamp: -1 });
    res.json({ trades });
};
exports.getUserTrades = getUserTrades;
const updateProfile = async (req, res) => {
    const userId = req.user?.id;
    const { name, email } = req.body;
    if (!name && !email) {
        res.status(400).json({ message: "No changes provided" });
        return;
    }
    const update = {};
    if (name)
        update.name = name;
    if (email)
        update.email = email;
    const user = await User_1.default.findByIdAndUpdate(userId, update, {
        new: true,
    }).select("-password");
    res.json({ user });
};
exports.updateProfile = updateProfile;
const changePassword = async (req, res) => {
    const userId = req.user?.id;
    const { currentPassword, newPassword } = req.body;
    const user = await User_1.default.findById(userId);
    if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
    }
    if (user.password) {
        if (!currentPassword || !newPassword) {
            res
                .status(400)
                .json({ message: "Current and new password are required" });
            return;
        }
        const isMatch = await bcryptjs_1.default.compare(currentPassword, user.password);
        if (!isMatch) {
            res.status(400).json({ message: "Current password is incorrect" });
            return;
        }
    }
    else {
        if (!newPassword) {
            res.status(400).json({ message: "New password is required" });
            return;
        }
    }
    user.password = await bcryptjs_1.default.hash(newPassword, 10);
    await user.save();
    res.json({ message: "Password updated successfully" });
};
exports.changePassword = changePassword;
//# sourceMappingURL=authController.js.map