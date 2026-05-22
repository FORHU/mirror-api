const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`;
  console.log("Tables in public schema:");
  console.log(result.map(r => r.table_name).join(', '));
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
