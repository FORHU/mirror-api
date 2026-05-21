/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Checking database for newly created outfits...");

  // Total count
  const count = await prisma.outfit.count({
    where: { isDeleted: false },
  });
  console.log(`Total active outfits in DB: ${count}\n`);

  // Get top 5 most recently created
  const newest = await prisma.outfit.findMany({
    where: { isDeleted: false },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      file: true,
      items: {
        include: {
          garment: true,
        },
      },
    },
  });

  if (newest.length === 0) {
    console.log("No outfits found in the database.");
    return;
  }

  console.log("=== Top 5 Newest Outfits ===");
  newest.forEach((outfit, index) => {
    console.log(`\n[${index + 1}] Outfit: "${outfit.name}"`);
    console.log(`    ID: ${outfit.id}`);
    console.log(`    Created At: ${outfit.createdAt.toISOString()}`);
    console.log(`    Design Type: ${outfit.designType}`);
    console.log(`    File URL: ${outfit.file?.fileUrl}`);
    console.log(`    Garments (${outfit.items.length}):`);
    outfit.items.forEach((item) => {
      console.log(`      - [${item.slot}] ${item.garment?.name} (ID: ${item.garmentId})`);
    });
  });
}

main()
  .catch((err) => {
    console.error("Error executing script:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
