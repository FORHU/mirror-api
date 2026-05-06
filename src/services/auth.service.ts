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
   * Login or Auto-Register with Email
   */
  static async login(email: string, platform?: string) {
    let user = await AuthRepo.findUserByEmail(email);

    if (!user) {
      // Auto-register new user
      const baseUsername = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
      const randomSuffix = crypto.randomBytes(2).toString("hex");
      const username = `${baseUsername}_${randomSuffix}`;

      user = await AuthRepo.createUser({
        email,
        username,
      }) as any;
      
      logger.info(`New user registered via simple login: ${email}`);
    }

    return this.generateAuthResponse(user, platform || "local");
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
          avatar: user.avatar?.fileUrl ?? null,
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
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      platform: provider,
    });

    await CacheUtil.set(`user:${user.id}`, user);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar?.fileUrl ?? null,
      },
    };
  }
}
