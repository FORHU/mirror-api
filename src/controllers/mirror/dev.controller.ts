import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { ACCESS_TOKEN_SECRET, ACCESS_TOKEN_EXPIRY } from "../../config";

const prisma = new PrismaClient();

export default async function devTokenHandler(req: Request, res: Response) {
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({ error: "Only available in development" });
  }

  try {
    const user = await prisma.user.findFirst({
      where: { email: "test@example.com" },
    });

    if (!user) {
      return res.status(404).json({ error: "Test user not found. Please run seed." });
    }

    const token = jwt.sign({ userId: user.id }, ACCESS_TOKEN_SECRET as string, {
      expiresIn: ACCESS_TOKEN_EXPIRY as unknown as number,
    });

    res.status(200).json({ token, user });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
}
