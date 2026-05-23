import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.count();
  const files = await prisma.file.count();
  const garments = await prisma.garment.count();
  const outfits = await prisma.outfit.count();
  const garmentInOutfits = await prisma.garmentInOutfit.count();
  const cosmetics = await prisma.cosmeticProduct.count();

  console.log("\n=======================================================");
  console.log("📊 CURRENT DATABASE ROW COUNTS");
  console.log("=======================================================");
  console.log(`👤 Users:               ${users}`);
  console.log(`📁 Files:               ${files}`);
  console.log(`👕 Garments:            ${garments}`);
  console.log(`👗 Outfits:             ${outfits}`);
  console.log(`🔗 GarmentInOutfits:    ${garmentInOutfits}`);
  console.log(`💄 Cosmetics:           ${cosmetics}`);
  console.log("=======================================================\n");

  await prisma.$disconnect();
}

main();
