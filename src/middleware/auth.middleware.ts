import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import AuthRepo from "../repositories/auth.repository";
import { ACCESS_TOKEN_SECRET } from "../config";

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as {
      userId: string;
    };
    const user = await AuthRepo.findUserById(decoded.userId);
    if (!user || (user as any).isDeleted) {
      return res.status(404).json({ message: "User not found" });
    }
    req.user = user;
    next();
  } catch (error: any) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
