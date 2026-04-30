import AuthRepo from "../repositories/auth.repository";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import logger from "../utils/logger";
import CacheUtil from "../utils/cache.util";
import {
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
} from "../config";

export default class AuthSvc {
  /**
   * Register a new user
   */
  static async register(data: {
    email: string;
    password: string;
    username: string;
    name?: string;
  }) {
    // Check if user already exists
    const existingUser = await AuthRepo.findUserByEmailOrUsername(data.email, data.username);
    if (existingUser) {
      if (existingUser.email === data.email) throw { status: 400, message: "User with this email already exists" };
      throw { status: 400, message: "Username is already taken" };
    }

    // Hash password using PBKDF2 (salt:hash)
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto
      .pbkdf2Sync(data.password, salt, 1000, 64, "sha512")
      .toString("hex");
    const hashedPassword = `${salt}:${hash}`;

    // Create user (verified by default in simple boilerplate)
    const user = await AuthRepo.createUser({
      email: data.email,
      password: hashedPassword,
      username: data.username,
      name: data.name,
    });

    logger.info(`User registered: ${user.email}`);
    
    return this.generateAuthResponse(user, "local");
  }

  /**
   * Login with email/password
   */
  static async login(data: { email: string; password: string }) {
    const user = await AuthRepo.findUserByEmail(data.email);
    if (!user) throw { status: 401, message: "Invalid credentials" };

    if (!user.password) throw { status: 401, message: "Account uses social login" };

    // Verify password
    const [salt, storedHash] = user.password.split(":");
    if (!salt || !storedHash) throw { status: 500, message: "Invalid password format" };

    const hash = crypto
      .pbkdf2Sync(data.password, salt, 1000, 64, "sha512")
      .toString("hex");

    if (storedHash !== hash) throw { status: 401, message: "Invalid credentials" };

    // Update login status and return response
    const updatedUser = await AuthRepo.updateUserLoginStatus(user.id);
    return this.generateAuthResponse(updatedUser || user, "local");
  }

  /**
   * Refresh access token
   */
  static async refreshToken(refreshToken: string) {
    try {
      const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as { userId: string };
      const session = await AuthRepo.findValidSession(refreshToken);
      
      if (!session) throw { status: 401, message: "Invalid refresh token" };

      const user = await AuthRepo.findUserById(decoded.userId);
      if (!user) throw { status: 404, message: "User not found" };

      const accessToken = jwt.sign({ userId: user.id }, ACCESS_TOKEN_SECRET, {
        expiresIn: ACCESS_TOKEN_EXPIRY as any,
      });

      return {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          role: user.role,
          avatar: user.avatar?.fileUrl,
          onboardingCompleted: user.onboardingCompleted,
        },
      };
    } catch (error) {
      throw { status: 401, message: "Invalid refresh token" };
    }
  }

  /**
   * Logout (invalidate session and clear cache)
   */
  static async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      await AuthRepo.deleteSession(refreshToken);
    }
    await CacheUtil.del(`user:${userId}`);
    return { message: "Logged out successfully" };
  }

  /**
   * Internal helper to generate tokens and session
   */
  private static async generateAuthResponse(user: any, provider: string) {
    const accessToken = jwt.sign({ userId: user.id }, ACCESS_TOKEN_SECRET, {
      expiresIn: ACCESS_TOKEN_EXPIRY as any,
    });

    const refreshToken = jwt.sign(
      { userId: user.id, jti: crypto.randomBytes(16).toString("hex") },
      REFRESH_TOKEN_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    await AuthRepo.createSession({
      userId: user.id,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      provider,
    });

    await CacheUtil.set(`user:${user.id}`, user);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role,
        avatar: user.avatar?.fileUrl,
        onboardingCompleted: user.onboardingCompleted,
      },
    };
  }
}
