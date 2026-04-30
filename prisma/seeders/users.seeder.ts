import { PrismaClient, UserRole } from "@prisma/client";
import crypto from "crypto";

/**
 * Seeds initial users with PBKDF2 hashed passwords
 */
export async function seedUsers(prisma: PrismaClient) {
  console.log("🌱 Seeding Users...");

  const users = [
    {
      email: "admin@example.com",
      username: "admin",
      name: "System Admin",
      role: UserRole.SUPER_ADMIN,
      password: "Password123!",
      isEmailVerified: true,
    },
    {
      email: "dev@example.com",
      username: "developer",
      name: "Lead Developer",
      role: UserRole.DEVELOPER,
      password: "Password123!",
      isEmailVerified: true,
    },
    {
      email: "user@example.com",
      username: "user1",
      name: "Regular User",
      role: UserRole.USER,
      password: "Password123!",
      isEmailVerified: true,
    },
  ];

  for (const userData of users) {
    const { password, ...rest } = userData;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: rest.email },
    });

    if (!existingUser) {
      // Hash password using the same method as AuthSvc
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto
        .pbkdf2Sync(password, salt, 1000, 64, "sha512")
        .toString("hex");
      const hashedPassword = `${salt}:${hash}`;

      await prisma.user.create({
        data: {
          ...rest,
          password: hashedPassword,
        },
      });
      console.log(`✅ Created user: ${rest.email}`);
    } else {
      console.log(`ℹ️ User already exists: ${rest.email}`);
    }
  }
}
