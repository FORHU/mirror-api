import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const cosmeticSeedNames = [
  "Daily Lightweight SPF 50",
  "Hydra Barrier Serum",
  "Niacinamide Pore Refining Serum",
  "Gentle Ceramide Cleanser",
  "Balancing BHA Toner",
  "Dewy Barrier Moisturizer",
  "Matte Oil-Control Moisturizer",
  "Weekly AHA/BHA Exfoliant",
];

async function main() {
  console.log("Starting modular database seeding...");

  try {
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

    console.log(`Created/verified test user: ${user.email} (ID: ${user.id})`);

    await prisma.cosmeticProduct.deleteMany({
      where: { name: { in: cosmeticSeedNames } },
    });

    await prisma.cosmeticProduct.createMany({
      data: [
        {
          name: "Daily Lightweight SPF 50",
          brand: "Smart Mirror Lab",
          details: "Broad-spectrum daily sunscreen with a light natural finish.",
          category: "SKINCARE",
          type: "SUNSCREEN",
          tags: ["high-uv", "non-comedogenic", "sensitive-skin"],
          benefits: ["UV protection", "Helps prevent dark spots", "Lightweight daily wear"],
          spf: 50,
          oilFree: true,
          finish: "NATURAL",
          priceAmount: 599,
          priceUnit: "PHP",
        },
        {
          name: "Hydra Barrier Serum",
          brand: "Smart Mirror Lab",
          details: "Hydrating serum for dehydrated or tight-feeling skin.",
          category: "SKINCARE",
          type: "SERUM",
          tags: ["hyaluronic acid", "ceramide", "dry-skin", "dehydrated"],
          benefits: ["Boosts hydration", "Supports skin barrier", "Softens dry patches"],
          hydrating: true,
          finish: "DEWY",
          priceAmount: 499,
          priceUnit: "PHP",
        },
        {
          name: "Niacinamide Pore Refining Serum",
          brand: "Smart Mirror Lab",
          details: "Oil-balancing serum for visible pores and uneven tone.",
          category: "SKINCARE",
          type: "SERUM",
          tags: ["niacinamide", "pore-care", "uneven-tone", "oily-skin"],
          benefits: ["Refines visible pores", "Balances shine", "Helps even skin tone"],
          oilFree: true,
          finish: "NATURAL",
          priceAmount: 459,
          priceUnit: "PHP",
        },
        {
          name: "Gentle Ceramide Cleanser",
          brand: "Smart Mirror Lab",
          details: "Low-stripping cleanser for sensitive and combination skin.",
          category: "SKINCARE",
          type: "CLEANSER",
          tags: ["ceramide", "fragrance-free", "sensitive-skin", "combination-skin"],
          benefits: ["Cleans without tightness", "Supports barrier", "Gentle daily use"],
          hydrating: true,
          finish: "NATURAL",
          priceAmount: 349,
          priceUnit: "PHP",
        },
        {
          name: "Balancing BHA Toner",
          brand: "Smart Mirror Lab",
          details: "Light toner for shine, pores, and acne-prone areas.",
          category: "SKINCARE",
          type: "TONER",
          tags: ["salicylic", "bha", "blackhead", "acne-prone", "oily-skin"],
          benefits: ["Unclogs pores", "Reduces excess shine", "Smooths texture"],
          oilFree: true,
          finish: "MATTE",
          priceAmount: 429,
          priceUnit: "PHP",
        },
        {
          name: "Dewy Barrier Moisturizer",
          brand: "Smart Mirror Lab",
          details: "Comfort moisturizer for dry, dull, or weather-stressed skin.",
          category: "SKINCARE",
          type: "MOISTURIZER",
          tags: ["ceramide", "oatmeal", "dry-skin", "sensitive-skin"],
          benefits: ["Repairs dry patches", "Calms redness", "Comforts tight skin"],
          hydrating: true,
          finish: "DEWY",
          priceAmount: 529,
          priceUnit: "PHP",
        },
        {
          name: "Matte Oil-Control Moisturizer",
          brand: "Smart Mirror Lab",
          details: "Light moisturizer for humid weather and oily T-zones.",
          category: "SKINCARE",
          type: "MOISTURIZER",
          tags: ["oily-skin", "humid-weather", "non-comedogenic"],
          benefits: ["Controls shine", "Lightweight hydration", "Good for humid days"],
          hydrating: true,
          oilFree: true,
          finish: "MATTE",
          priceAmount: 529,
          priceUnit: "PHP",
        },
        {
          name: "Weekly AHA/BHA Exfoliant",
          brand: "Smart Mirror Lab",
          details: "Weekly exfoliant for texture, pores, and uneven tone.",
          category: "SKINCARE",
          type: "EXFOLIANT",
          tags: ["glycolic", "salicylic", "aha", "bha", "uneven-tone", "pore-care"],
          benefits: ["Brightens uneven tone", "Smooths texture", "Helps clear pores"],
          oilFree: true,
          finish: "NATURAL",
          priceAmount: 489,
          priceUnit: "PHP",
        },
      ],
    });

    console.log("Seeded cosmetic recommendation catalog with matching data");
    console.log("All seeder modules executed successfully!");
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
