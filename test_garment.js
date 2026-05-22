const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.garment.count();
  console.log("Garment count:", count);
}

main()
  .catch(e => {
    console.error("Error:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
