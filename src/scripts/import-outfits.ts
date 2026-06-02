/**
 * import-outfits.ts
 * -----------------
 * Reads outfits-export.json from the project root and upserts every outfit
 * (File → Outfit → GarmentInOutfit) into the current database.
 *
 * Safe to re-run: uses upsert so existing records are left untouched.
 * Garments referenced by items must already exist in the DB.
 *
 * Usage:
 *   npx ts-node --files src/scripts/import-outfits.ts
 */

import { PrismaClient, Prisma } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

interface ExportedFile {
  id: string;
  filename: string;
  originalName: string | null;
  fileUrl: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  extension: string | null;
  size: number | null;
  provider: string;
  bucket: string | null;
  path: string | null;
  metaData: unknown;
  createdAt: string;
}

interface ExportedItem {
  id: string;
  garmentId: string;
  outfitId: string;
  slot: string | null;
  layerLevel: string | null;
}

interface ExportedOutfit {
  id: string;
  name: string;
  description: string | null;
  metaData: unknown;
  isPublic: boolean;
  designType: string | null;
  fileId: string;
  userOutlineId: string | null;
  userId: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  file: ExportedFile;
  items: ExportedItem[];
}

async function main() {
  const exportPath = path.resolve(__dirname, "../../outfits-export.json");

  if (!fs.existsSync(exportPath)) {
    console.error(`❌  File not found: ${exportPath}`);
    process.exit(1);
  }

  const outfits: ExportedOutfit[] = JSON.parse(fs.readFileSync(exportPath, "utf-8"));
  console.log(`📦  Found ${outfits.length} outfits to import.\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const outfit of outfits) {
    try {
      // 1. Upsert the display File row
      await prisma.file.upsert({
        where: { id: outfit.file.id },
        update: {},
        create: {
          id: outfit.file.id,
          filename: outfit.file.filename,
          originalName: outfit.file.originalName,
          fileUrl: outfit.file.fileUrl,
          thumbnailUrl: outfit.file.thumbnailUrl,
          mimeType: outfit.file.mimeType,
          extension: outfit.file.extension,
          size: outfit.file.size,
          provider: outfit.file.provider as string,
          bucket: outfit.file.bucket,
          path: outfit.file.path,
        } as Prisma.FileCreateInput,
      });

      // 2. Check which garments actually exist in this DB
      const garmentIds = outfit.items.map((i) => i.garmentId);
      const existingGarments = await prisma.garment.findMany({
        where: { id: { in: garmentIds } },
        select: { id: true },
      });
      const existingGarmentSet = new Set(existingGarments.map((g) => g.id));
      const validItems = outfit.items.filter((i) => existingGarmentSet.has(i.garmentId));

      if (validItems.length === 0 && outfit.items.length > 0) {
        console.warn(`  ⚠️  [${outfit.name}] — no garments found locally, skipping.`);
        skipped++;
        continue;
      }

      // 3. Upsert the Outfit row (without items — we handle those separately)
      const existing = await prisma.outfit.findUnique({ where: { id: outfit.id } });

      if (existing) {
        console.log(`  ✓  [${outfit.name}] already exists — skipped.`);
        skipped++;
        continue;
      }

      await prisma.outfit.create({
        data: {
          id: outfit.id,
          name: outfit.name,
          description: outfit.description,
          metaData: outfit.metaData as Prisma.InputJsonValue,
          isPublic: outfit.isPublic,
          designType: outfit.designType as string,
          isDeleted: outfit.isDeleted,
          // System outfits have no user (userId = null) — omit the relation entirely
          ...(outfit.userId ? { user: { connect: { id: outfit.userId } } } : {}),
          file: { connect: { id: outfit.file.id } },
          items: {
            create: validItems.map((item) => ({
              id: item.id,
              garment: { connect: { id: item.garmentId } },
              slot: item.slot as string,
              layerLevel: item.layerLevel as string,
            })),
          },
        } as unknown as Prisma.OutfitCreateInput,
      });

      const skippedCount = outfit.items.length - validItems.length;
      const note = skippedCount > 0 ? ` (${skippedCount} garment(s) not in DB — skipped)` : "";
      console.log(`  ✅  [${outfit.name}] imported with ${validItems.length} items.${note}`);
      created++;
    } catch (err) {
      console.error(`  ❌  [${outfit.name}] failed: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n📊  Done — ${created} imported, ${skipped} skipped, ${errors} errors.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
