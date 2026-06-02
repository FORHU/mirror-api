import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const system = await p.outfit.count({ where: { userId: null } });
  const user = await p.outfit.count({ where: { userId: { not: null } } });
  const total = await p.outfit.count();
  console.log("System outfits (userId=null):", system);
  console.log("User outfits:", user);
  console.log("Total:", total);
  await p.$disconnect();
}
main();
