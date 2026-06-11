import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const garments = await prisma.garment.count();
  const outfits = await prisma.outfit.count();
  const cosmetics = await prisma.cosmeticProduct.count();
  
  console.log('--- Database Row Counts ---');
  console.log(`👕 Garments: ${garments}`);
  console.log(`👗 Outfits: ${outfits}`);
  console.log(`💄 Cosmetics: ${cosmetics}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
