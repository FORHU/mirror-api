import AuthRepo from "../../repositories/auth.repository";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import logger from "../../utils/logger";
import CacheUtil from "../../utils/cache.util";
import { ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET, REFRESH_TOKEN_EXPIRY, ACCESS_TOKEN_EXPIRY, GOOGLE_CLIENT_ID } from '../../config';
import { OAuth2Client } from "google-auth-library";

export default class AuthSvc {
  /**
   * Login or Auto-Register with Email
   */
  static async login(email: string, platform?: string, providedUsername?: string) {
    let user = await AuthRepo.findUserByEmail(email);

    if (!user) {
      let username = providedUsername;

      if (!username) {
        // Auto-generate username
        const baseUsername = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
        const randomSuffix = crypto.randomBytes(2).toString("hex");
        username = `${baseUsername}_${randomSuffix}`;
      } else {
        // Check if provided username is already taken
        const existingUser = await AuthRepo.findUserByUsername(username);
        if (existingUser) {
          throw { status: 400, message: "Username is already taken" };
        }
      }

      user = await AuthRepo.createUser({
        email,
        username,
      }) as any;

      logger.info(`New user registered via simple login: ${email}`);
    }

    return this.generateAuthResponse(user, platform || "local");
  }

  /**
   * Google Auth SSO
   */
  static async googleAuthSSO(idToken: string) {
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);

    try {
      // Verify the ID token with Google
      const ticket = await client.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw { status: 401, message: "Invalid Google token payload" };
      }

      // Generate a username if needed
      const baseUsername = payload.email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
      const randomSuffix = crypto.randomBytes(2).toString("hex");
      const username = `${baseUsername}_${randomSuffix}`;

      // Find or create user
      const user = await AuthRepo.findOrCreateGoogleUser({
        email: payload.email,
        username: username,
        avatarUrl: payload.picture,
      });

      // Complete OAuth login flow
      return this.generateAuthResponse(user, "google", payload.sub, payload.picture);
    } catch (error: any) {
      logger.error("[AuthSvc] Google SSO verification failed:", error);
      throw { status: 401, message: "Failed to verify Google token: " + (error.message || error) };
    }
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
  private static async generateAuthResponse(
    user: any,
    platform: string,
    providerUserId?: string,
    providerAvatarUrl?: string
  ) {
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
      platform,
      provider: platform === "google" ? "google" : undefined,
      providerUserId,
      providerAvatarUrl,
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

  static async updateProfile(userId: string, data: any) {
    try {
      const user = await AuthRepo.updateUser(userId, data);
      return user;
    } catch (error: any) {
      throw { status: 500, message: "Failed to update profile: " + (error.message || error) };
    }
  }

}

