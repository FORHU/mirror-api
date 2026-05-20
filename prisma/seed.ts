import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting modular database seeding...");

  try {
    // Create a default test user matching the actual schema
    const email = "test@example.com";
    const username = "testuser_dev";

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        username,
        gender: "MALE",
        isDeleted: false,
      },
    });

    console.log(`✅ Created/verified test user: ${user.email} (ID: ${user.id})`);
    console.log("🎉 All seeder modules executed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
