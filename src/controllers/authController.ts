import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import crypto from "crypto";
import Trade from "../models/Trade";
import { sendVerificationEmail } from "../services/email/email.service";
import { TwoFactorAuthService } from "../services/2fa/twoFactorAuth.service";

const frontend = process.env.FRONTEND;
const JWT_SECRET = process.env.JWT_SECRET || "secret";

const sendEmail = async (
  to: string,
  subject: string,
  text: string,
): Promise<void> => {
  console.log(`Email to ${to}: ${subject}\n${text}`);
};

export const register = async (req: Request, res: Response): Promise<void> => {
  const { email, password, name } = req.body;
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    res.status(400).json({ message: "User already exists" });
    return;
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  const emailVerificationToken = crypto.randomBytes(32).toString("hex");
  const user = new User({
    email,
    password: hashedPassword,
    name,
    emailVerificationToken,
  });
  await user.save();
  const verificationLink = `${frontend}/auth/verify-email?email=${encodeURIComponent(email)}&token=${emailVerificationToken}`;
  await sendVerificationEmail(email, verificationLink);
  console.log(`Verification link: ${verificationLink}`);
  res
    .status(201)
    .json({ message: "User registered. Please verify your email." });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, twoFAToken } = req.body;
    const user = await User.findOne({ email });
    
    if (!user || !user.password) {
      res.status(400).json({ message: 'Invalid credentials' });
      return;
    }

    if (!password) {
      res.status(400).json({ message: 'Password is required' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(400).json({ message: 'Invalid credentials' });
      return;
    }

    if (!user.isEmailVerified) {
      res.status(403).json({ message: 'Email not verified' });
      return;
    }

    // Check if 2FA is enabled
    if (user.twoFAEnabled) {
      if (!twoFAToken) {
        res.status(403).json({ 
          message: '2FA token required',
          requires2FA: true
        });
        return;
      }

      // Verify 2FA token
      if (!user.twoFASecret) {
        res.status(500).json({ message: '2FA configuration error' });
        return;
      }

      const isValid = TwoFactorAuthService.verifyToken(user.twoFASecret, twoFAToken);
      if (!isValid) {
        res.status(400).json({ message: 'Invalid 2FA token' });
        return;
      }

      user.twoFAVerified = true;
      await user.save();
    }

    // Generate JWT token
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1d' });

    res.json({
      token,
      user: {
        email: user.email,
        name: user.name,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionPlan: user.subscriptionPlan,
        hasPassword: !!user.password,
        twoFAEnabled: user.twoFAEnabled
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed' });
  }
};

export const verifyEmail = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { email, token } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.emailVerificationToken !== token) {
    res.status(400).json({ message: "Invalid token" });
    return;
  }
  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  await user.save();
  res.json({ message: "Email verified" });
};

export const forgotPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) {
    res.status(400).json({ message: "User not found" });
    return;
  }
  const resetToken = crypto.randomBytes(32).toString("hex");
  user.resetPasswordToken = resetToken;
  await user.save();
  const resetLink = `${frontend}/auth/reset-password?email=${encodeURIComponent(email)}&token=${resetToken}`;
  await sendEmail(
    email,
    "Reset your password",
    `Click the link to reset: ${resetLink}\nOr use this token: ${resetToken}`
  );
  console.log(`Password reset link: ${resetLink}`);
  res.json({ message: "Password reset email sent" });
};

export const resetPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { email, token, newPassword } = req.body;
  const user = await User.findOne({ email });
  if (!user || user.resetPasswordToken !== token) {
    res.status(400).json({ message: "Invalid token" });
    return;
  }
  user.password = await bcrypt.hash(newPassword, 10);
  user.resetPasswordToken = undefined;
  await user.save();
  res.json({ message: "Password reset successful" });
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const userWithPassword = await User.findById(userId).select("password");
  if (!userWithPassword) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  const user = await User.findById(userId).select(
    "-password -emailVerificationToken -resetPasswordToken -twoFASecret"
  );
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
      twoFAEnabled: user.twoFAEnabled,
      twoFAVerified: user.twoFAVerified,
    },
  });
};

export const googleAuthCallback = async (
  req: Request,
  res: Response
): Promise<void> => {
  const user = req.user as { _id: string } | undefined;
  if (!user) {
    res.status(401).json({ message: "Google authentication failed" });
    return;
  }
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1d" });
  const frontendUrl = process.env.FRONTEND;
  res.redirect(`${frontendUrl}/auth?token=${token}`);
};

export const getUserTrades = async (
  req: Request,
  res: Response
): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const trades = await Trade.find({ user: userId }).sort({ timestamp: -1 });
  res.json({ trades });
};

export const updateProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const { name, email } = req.body;
  if (!name && !email) {
    res.status(400).json({ message: "No changes provided" });
    return;
  }
  const update: Partial<{ name: string; email: string }> = {};
  if (name) update.name = name;
  if (email) update.email = email;
  const user = await User.findByIdAndUpdate(userId, update, {
    new: true,
  }).select("-password");
  res.json({ user });
};

export const changePassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const userId = (req.user as { id: string })?.id;
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(userId);
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
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      res.status(400).json({ message: "Current password is incorrect" });
      return;
    }
  } else {
    if (!newPassword) {
      res.status(400).json({ message: "New password is required" });
      return;
    }
  }
  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.json({ message: "Password updated successfully" });
};
