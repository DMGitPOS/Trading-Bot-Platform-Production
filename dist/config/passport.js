"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const passport_1 = __importDefault(require("passport"));
const passport_google_oauth20_1 = require("passport-google-oauth20");
const User_1 = __importDefault(require("../models/User"));
passport_1.default.serializeUser((user, done) => {
    done(null, user.id);
});
passport_1.default.deserializeUser(async (id, done) => {
    try {
        const user = await User_1.default.findById(id);
        done(null, user);
    }
    catch (err) {
        done(err, undefined);
    }
});
passport_1.default.use(new passport_google_oauth20_1.Strategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/api/auth/google/callback',
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await User_1.default.findOne({ googleId: profile.id });
        if (!user) {
            // Check if a user with the same email exists (account linking)
            const email = profile.emails?.[0].value;
            user = await User_1.default.findOne({ email });
            if (user) {
                user.googleId = profile.id;
                user.isEmailVerified = true;
                await user.save();
            }
            else {
                user = await User_1.default.create({
                    googleId: profile.id,
                    email,
                    name: profile.displayName,
                    isEmailVerified: true,
                });
            }
        }
        return done(null, user);
    }
    catch (err) {
        return done(err, undefined);
    }
}));
exports.default = passport_1.default;
//# sourceMappingURL=passport.js.map