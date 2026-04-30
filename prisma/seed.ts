import { PrismaClient } from "@prisma/client";
import { seedUsers } from "./seeders/users.seeder";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting modular database seeding...");

  try {
    await seedUsers(prisma);
    console.log("🎉 All seeder modules executed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
