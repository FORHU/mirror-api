/**
 * Imports src/mocks/chatwonder-results.json into CosmeticProduct.
 *
 * Safe to re-run: matches by product_id first, then by stripped fileUrlId.
 */

import fs from "fs";
import path from "path";
import { COSMETIC_CATEGORY, COSMETIC_FINISH, COSMETIC_TYPE, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CDN_BASE = "https://d1bdogktone6hj.cloudfront.net";
const CDN_PREFIX = `${CDN_BASE}/`;

const SPF_OVERRIDES: Record<string, number> = {
  prod_av_ne_pierre_fabre_sunscreen_sunsimed: 50,
  prod_banana_boat_sunscreen_ultrasport_faces_sunscreen: 30,
  prod_biafine_sunscreen_soleilbiafine_lait_spray: 50,
  prod_biolane_sunscreen_cr_me_solaire_haute: 50,
  prod_corinne_de_farme_sunscreen_spray_protecteur_sensitive: 50,
  prod_ducray_sunscreen_fluide_anti_imperfection: 50,
  prod_earth_mama_sunscreen_mineral_sunscreen_lotion: 40,
  prod_klorane_sunscreen_spray_solaire_sublime: 50,
  prod_la_roche_posay_sunscreen_dermo_pediatrics_spray_applica: 50,
  prod_laboratoires_vichy_sunscreen_spray_douceur_enfants: 50,
  prod_lovea_lovea_kids_sunscreen_spray_protecteur_hydratant: 50,
  prod_mad_hippie_sunscreen_daily_protective_serum: 30,
  prod_nivea_sunscreen_nivea_sun_protect: 50,
  prod_tula_sunscreen_tula_sun_protection: 30,
};

type Ingredient = {
  name: string;
  function?: string;
  safety_concern?: string;
  safety_notes?: string;
  skin_type_verdict?: string;
  skin_type_notes?: string;
};

type ChatWonderEntry = {
  success: boolean;
  product_name?: string;
  brand?: string;
  label_claims?: string[];
  skin_type?: string;
  ingredients?: Ingredient[];
  summary?: string;
  front_s3_key?: string;
  back_s3_key?: string;
};

type RawProduct = {
  product_id: string;
  name: string;
  brand: string;
  category: string;
  type: string;
  status: string;
  chatwonder: ChatWonderEntry | null;
};

function claimsHave(claims: string[], ...terms: string[]): boolean {
  return claims.some((claim) => terms.some((term) => claim.toLowerCase().includes(term)));
}

function extractSpf(claims: string[], ...extraText: Array<string | null | undefined>): number | null {
  for (const text of [...claims, ...(extraText.filter(Boolean) as string[])]) {
    const match = text.match(/(?:spf|fps|sun\s*protection\s*factor)\s*\+?\s*(\d{1,3})/i);
    if (!match) continue;

    const value = Number.parseInt(match[1], 10);
    if (value > 0 && value <= 100) return value;
  }
  return null;
}

function extractFinish(claims: string[], ...extraText: Array<string | null | undefined>): COSMETIC_FINISH {
  const text = [...claims, ...(extraText.filter(Boolean) as string[])].join(" ").toLowerCase();
  if (/(matte|mattifying|matifiant|oil[-\s]?control|shine[-\s]?free)/i.test(text)) {
    return COSMETIC_FINISH.MATTE;
  }
  if (/(dewy|glow|glowing|luminous|radiant|hydrating|hydration|moisturizing|nourishing)/i.test(text)) {
    return COSMETIC_FINISH.DEWY;
  }
  return COSMETIC_FINISH.NATURAL;
}

function extractBenefits(ingredients: Ingredient[]): string[] {
  return ingredients
    .filter((ingredient) => ingredient.skin_type_verdict === "beneficial" && ingredient.name)
    .map((ingredient) => ingredient.name)
    .slice(0, 10);
}

function toCategory(raw: string): COSMETIC_CATEGORY | null {
  const map: Record<string, COSMETIC_CATEGORY> = {
    EYES: COSMETIC_CATEGORY.EYES,
    FACE: COSMETIC_CATEGORY.FACE,
    LIPS: COSMETIC_CATEGORY.LIPS,
    SKINCARE: COSMETIC_CATEGORY.SKINCARE,
  };
  return map[raw.toUpperCase()] ?? null;
}

function toType(raw: string): COSMETIC_TYPE | null {
  return (COSMETIC_TYPE as Record<string, COSMETIC_TYPE>)[raw.toUpperCase()] ?? null;
}

function stripCloudFront(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith(CDN_PREFIX) ? value.slice(CDN_PREFIX.length) : value;
}

function filenameFromPath(value: string): string {
  return path.posix.basename(value) || "image.png";
}

async function main() {
  const jsonPath = path.resolve(process.cwd(), "src/mocks/chatwonder-results.json");
  const raw: RawProduct[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const products = raw.filter((product) => product.chatwonder?.success === true);

  console.log(`${products.length} products to import (${raw.length - products.length} skipped)`);

  let created = 0;
  let updated = 0;
  let errors = 0;
  const batchSize = 50;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (product) => {
        const chatwonder = product.chatwonder;
        if (!chatwonder) return;

        const claims = chatwonder.label_claims ?? [];
        const ingredients = chatwonder.ingredients ?? [];
        const imageUrl = chatwonder.front_s3_key ? `${CDN_BASE}/${chatwonder.front_s3_key}` : null;
        const imagePath = stripCloudFront(imageUrl);

        const payload = {
          id: product.product_id,
          name: chatwonder.product_name || product.name,
          brand: chatwonder.brand || product.brand || null,
          details: chatwonder.summary || null,
          hexColor: chatwonder.skin_type || null,
          fileUrlId: imagePath,
          category: toCategory(product.category),
          type: toType(product.type),
          tags: claims,
          benefits: extractBenefits(ingredients),
          spf:
            SPF_OVERRIDES[product.product_id] ??
            extractSpf(claims, chatwonder.product_name, chatwonder.summary, product.name),
          waterproof: claimsHave(claims, "waterproof", "water-resistant", "water resistant"),
          transferProof: claimsHave(
            claims,
            "transfer-proof",
            "transfer proof",
            "long-lasting",
            "long lasting",
            "24h",
            "24-hour"
          ),
          hydrating: claimsHave(claims, "moisturizing", "hydrating", "hydration", "nourishing"),
          oilFree: claimsHave(claims, "oil-free", "oil free", "non-comedogenic", "noncomedogenic", "mattifying"),
          finish: extractFinish(claims, chatwonder.product_name, chatwonder.summary, product.name),
          metaData: ingredients.slice(0, 20),
        };

        try {
          if (imagePath && imageUrl) {
            await prisma.file.upsert({
              where: { id: imagePath },
              update: {
                filename: filenameFromPath(imagePath),
                fileUrl: imageUrl,
                path: imagePath,
              },
              create: {
                id: imagePath,
                filename: filenameFromPath(imagePath),
                fileUrl: imageUrl,
                mimeType: "image/png",
                extension: "png",
                provider: "S3",
                bucket: "d1bdogktone6hj.cloudfront.net",
                path: imagePath,
              },
            });
          }

          await prisma.$transaction(async (tx) => {
            const target = await tx.cosmeticProduct.findUnique({
              where: { id: product.product_id },
              select: { id: true },
            });
            const legacy = await tx.cosmeticProduct.findFirst({
              where: {
                id: { not: product.product_id },
                OR: [
                  {
                    metaData: {
                      path: ["product_id"],
                      equals: product.product_id,
                    },
                  },
                  ...(imagePath ? [{ fileUrlId: imagePath }] : []),
                ],
              },
              select: { id: true },
            });

            if (target) {
              await tx.cosmeticProduct.update({ where: { id: target.id }, data: payload });
              if (legacy) {
                await tx.cosmeticRecommendation.updateMany({
                  where: { cosmeticProductId: legacy.id },
                  data: { cosmeticProductId: target.id },
                });
                await tx.cosmeticProduct.delete({ where: { id: legacy.id } });
              }
              updated++;
              return;
            }

            if (legacy) {
              await tx.cosmeticProduct.update({ where: { id: legacy.id }, data: payload });
              updated++;
              return;
            }

            await tx.cosmeticProduct.create({ data: payload });
            created++;
          });
        } catch (error) {
          errors++;
          console.error(`${product.product_id}: ${(error as Error).message}`);
        }
      })
    );

    const done = Math.min(i + batchSize, products.length);
    process.stdout.write(`\r${done}/${products.length}`);
  }

  console.log(`\nDone - created: ${created}, updated: ${updated}, errors: ${errors}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
