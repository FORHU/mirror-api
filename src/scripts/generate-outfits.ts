/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
/**
 * Bulk rule-based outfit generator. No AI.
 *
 * Behavior is "top up to N": for each CATEGORY, counts existing outfits in
 * the scope (system by default, --user=X for a specific user) and only
 * generates enough new ones to reach --count total. Re-running the same
 * command is a no-op once the target is met.
 *
 * Usage:
 *   ts-node src/scripts/generate-outfits.ts
 *   ts-node src/scripts/generate-outfits.ts --count=5
 *   ts-node src/scripts/generate-outfits.ts --category=Streetwear --count=10
 *   ts-node src/scripts/generate-outfits.ts --gender=MALE --count=2
 *   ts-node src/scripts/generate-outfits.ts --user=clx123abc --count=3
 */

import { PrismaClient, CATEGORY, GARMENT_GENDER } from "@prisma/client";
import OutfitService from "../services/shared/outfit.service";

const prisma = new PrismaClient();

interface Args {
  category?: CATEGORY;
  gender?: GARMENT_GENDER;
  count: number;
  userId?: string;
}

function parseArgs(): Args {
  const out: Args = { count: 3 };
  for (const arg of process.argv.slice(2)) {
    const [k, vRaw] = arg.replace(/^--/, "").split("=");
    const v = vRaw?.trim();
    if (!v) continue;
    if (k === "category") {
      if (!(Object.values(CATEGORY) as string[]).includes(v)) {
        throw new Error(`Unknown category "${v}". Allowed: ${Object.values(CATEGORY).join(", ")}`);
      }
      out.category = v as CATEGORY;
    } else if (k === "gender") {
      if (!(Object.values(GARMENT_GENDER) as string[]).includes(v)) {
        throw new Error(
          `Unknown gender "${v}". Allowed: ${Object.values(GARMENT_GENDER).join(", ")}`
        );
      }
      out.gender = v as GARMENT_GENDER;
    } else if (k === "count") {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 1)
        throw new Error(`--count must be a positive integer, got "${v}"`);
      out.count = n;
    } else if (k === "user") {
      out.userId = v;
    }
  }
  return out;
}

/**
 * Existing rule-recommend outfits for a category in the given scope.
 * Counted via metaData.category so it tracks rows the script itself made;
 * manually-created outfits without that key don't count toward the quota.
 */
async function existingIdsFor(category: CATEGORY, userId: string | null): Promise<Set<string>> {
  const rows = await prisma.outfit.findMany({
    where: {
      userId,
      isDeleted: false,
      metaData: { path: ["category"], equals: category },
    },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

async function main() {
  const args = parseArgs();
  const scopeUserId = args.userId ?? null;
  const categories = args.category ? [args.category] : (Object.values(CATEGORY) as CATEGORY[]);

  console.log(
    `🪡  Top-up generate — categories=${categories.length}, targetPerCategory=${args.count}` +
      `${args.gender ? `, gender=${args.gender}` : ""}` +
      `${args.userId ? `, userId=${args.userId}` : " (system)"}`
  );

  let created = 0;
  let reused = 0;
  let skipped = 0;
  let exhausted = 0;
  let failed = 0;

  for (const category of categories) {
    const existing = await existingIdsFor(category, scopeUserId);
    const sessionNew = new Set<string>();
    const needed = args.count - existing.size;

    if (needed <= 0) {
      console.log(`  ⊘ ${category}: already at ${existing.size}/${args.count}, skipping`);
      continue;
    }

    // Cap retries to avoid spinning on small wardrobes that can't produce
    // enough unique combinations. 4× the target is generous but bounded.
    const maxAttempts = needed * 4;
    let attempts = 0;
    let categoryHas404 = false;

    while (sessionNew.size < needed && attempts < maxAttempts && !categoryHas404) {
      attempts++;
      try {
        const outfit = await OutfitService.recommendOutfit({
          category,
          gender: args.gender,
          userId: args.userId,
          name: `${category} look ${existing.size + sessionNew.size + 1}`,
        });
        // Dedupe returned an existing row — either pre-existing or one we
        // already produced in this run. Either way, it doesn't count toward
        // the target.
        if (existing.has(outfit.id) || sessionNew.has(outfit.id)) {
          reused++;
          continue;
        }
        sessionNew.add(outfit.id);
        created++;
        console.log(
          `  ✓ ${category} → ${outfit.id} (${existing.size + sessionNew.size}/${args.count})`
        );
      } catch (err: any) {
        if (err?.status === 404) {
          skipped++;
          categoryHas404 = true;
          console.log(`  - ${category}: ${err.message}`);
        } else {
          failed++;
          console.error(`  ✗ ${category}: ${err?.message || err}`);
        }
      }
    }

    const finalCount = existing.size + sessionNew.size;
    if (!categoryHas404 && finalCount < args.count) {
      exhausted++;
      console.log(
        `  ⚠ ${category}: stopped at ${finalCount}/${args.count} after ${attempts} attempts — wardrobe variety limit`
      );
    }
  }

  console.log(
    `\nDone. created=${created}, reused=${reused}, skipped=${skipped}, exhausted=${exhausted}, failed=${failed}`
  );
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
