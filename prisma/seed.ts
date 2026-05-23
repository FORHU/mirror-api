import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const CSV_DIR = "C:\\Users\\devrm\\Documents\\mirror-api";

// Reads all non-empty lines from a CSV file
function readCSVFile(filename: string): string[] {
  const filePath = path.join(CSV_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File ${filename} not found in ${CSV_DIR}, skipping.`);
    return [];
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return content.split(/\r?\n/).filter(line => line.trim().length > 0);
}

// Parses a CSV line handling contextual boundary quotes and JSON quote escaping sequences like '" and "'
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  let isJSONOrArrayField = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      const isOpening = (i === 0 || line[i - 1] === ',');
      const isClosing = (i === line.length - 1 || line[i + 1] === ',');
      
      if (isOpening && !inQuotes) {
        inQuotes = true;
        // Check if this is a JSON/Array field
        let nextIdx = i + 1;
        while (nextIdx < line.length && /\s/.test(line[nextIdx])) {
          nextIdx++;
        }
        if (nextIdx < line.length && (line[nextIdx] === '{' || line[nextIdx] === '[')) {
          isJSONOrArrayField = true;
          braceDepth = 0;
          bracketDepth = 0;
        } else {
          isJSONOrArrayField = false;
        }
      } else if (isClosing && inQuotes) {
        const insideNested = isJSONOrArrayField && (braceDepth > 0 || bracketDepth > 0);
        if (!insideNested) {
          inQuotes = false;
          isJSONOrArrayField = false;
        } else {
          current += char;
        }
      } else {
        current += char;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = "";
      isJSONOrArrayField = false;
      braceDepth = 0;
      bracketDepth = 0;
    } else {
      current += char;
      if (isJSONOrArrayField) {
        if (char === '{') braceDepth++;
        else if (char === '}') braceDepth--;
        else if (char === '[') bracketDepth++;
        else if (char === ']') bracketDepth--;
      }
    }
  }
  result.push(current);
  return result;
}

// Trims outer single/double quotes recursively
function trimQuotes(str: string): string {
  if (!str) return "";
  let s = str.trim();
  while (
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

// Converts empty strings or invalid values to null
function cleanOptionalString(val: string | undefined | null): string | null {
  if (!val) return null;
  const s = trimQuotes(val);
  return s === "" ? null : s;
}

// Parses Postgres string arrays like "{Casual,SmartCasual}"
function parseArrayField(val: string): string[] {
  if (!val) return [];
  let cleaned = val.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.trim();
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    cleaned = cleaned.slice(1, -1);
  }
  if (!cleaned) return [];
  return cleaned
    .split(",")
    .map(item => trimQuotes(item))
    .filter(Boolean);
}

// Parses escaped Postgres JSON fields
function parseJSONField(val: string): any {
  if (!val || val === "null" || val === '""') return null;
  let cleaned = val.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.trim();
  // Replace escaping sequences like '" and "' with standard quotes
  cleaned = cleaned.replace(/'"/g, '"').replace(/"'/g, '"');
  cleaned = cleaned.replace(/'([^']+)'/g, '"$1"');
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    try {
      // Fallback: replace any quote clusters with a single double quote
      const fallback = cleaned.replace(/['"]+/g, '"');
      return JSON.parse(fallback);
    } catch (e) {
      return null;
    }
  }
}

async function main() {
  console.log("🚀 Starting database populate from CSV files...");

  try {
    // 1. Purge all tables in cascade to maintain referential integrity
    console.log("🧹 Cascading purge of all tables...");
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE 
        "GarmentInOutfit", "Interaction", "CosmeticRecommendation", "SkinAnalysis", 
        "WeatherSnapshot", "UserMap", "UserOutline", "Embedding", "ChatMessage", 
        "Conversation", "Session", "Outfit", "Garment", "_GarmentToTag", "Tag", 
        "CosmeticProduct", "User", "File", "Calendar" 
      CASCADE;
    `);
    console.log("✨ All tables successfully purged.");

    // 2. Seed File table
    console.log("📁 Seeding File table...");
    const fileLines = readCSVFile("File.csv");
    let fileCount = 0;
    for (const line of fileLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 4) continue;
      const id = fields[0];
      const filename = trimQuotes(fields[1]);
      const originalName = fields[2] ? trimQuotes(fields[2]) : null;
      const fileUrl = trimQuotes(fields[3]);
      const thumbnailUrl = fields[4] ? trimQuotes(fields[4]) : null;
      const mimeType = fields[5] ? trimQuotes(fields[5]) : null;
      const extension = fields[6] ? trimQuotes(fields[6]) : null;
      const size = fields[7] ? parseInt(fields[7], 10) : null;
      const provider = fields[8] ? trimQuotes(fields[8]) : "S3";
      const bucket = fields[9] ? trimQuotes(fields[9]) : null;
      const pathVal = fields[10] ? trimQuotes(fields[10]) : null;
      const metaData = fields[11] ? parseJSONField(fields[11]) : null;
      const createdAt = fields[12] ? new Date(fields[12]) : new Date();

      try {
        await prisma.file.create({
          data: {
            id,
            filename,
            originalName,
            fileUrl,
            thumbnailUrl,
            mimeType,
            extension,
            size: isNaN(size as number) ? null : size,
            provider,
            bucket,
            path: pathVal,
            metaData: metaData || undefined,
            createdAt,
          }
        });
        fileCount++;
      } catch (err) {
        console.error(`❌ Failed to seed File id=${id}:`, err);
      }
    }
    console.log(`✅ Seeded ${fileCount} File records.`);

    // 3. Seed Tag table
    console.log("🏷️ Seeding Tag table...");
    const tagLines = readCSVFile("Tag.csv");
    let tagCount = 0;
    for (const line of tagLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 2) continue;
      const id = fields[0];
      const name = trimQuotes(fields[1]);
      try {
        await prisma.tag.create({
          data: { id, name }
        });
        tagCount++;
      } catch (err) {
        console.error(`❌ Failed to seed Tag id=${id}:`, err);
      }
    }
    console.log(`✅ Seeded ${tagCount} Tag records.`);

    // 4. Seed User table
    console.log("👤 Seeding User table...");
    const userLines = readCSVFile("User.csv");
    let userCount = 0;
    for (const line of userLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 4) continue;
      const id = fields[0];
      const email = trimQuotes(fields[1]);
      const username = trimQuotes(fields[2]);
      const gender = trimQuotes(fields[3]) as any; // USER_GENDER
      const avatarId = fields[4] ? trimQuotes(fields[4]) : null;
      const isDeleted = fields[5] === "t";
      const createdAt = fields[6] ? new Date(fields[6]) : new Date();
      const updatedAt = fields[7] ? new Date(fields[7]) : new Date();
      const homeLocationLat = fields[8] ? parseFloat(fields[8]) : null;
      const homeLocationLng = fields[9] ? parseFloat(fields[9]) : null;
      const userMeasurement = fields[10] ? parseJSONField(fields[10]) : null;

      try {
        await prisma.user.create({
          data: {
            id,
            email,
            username,
            gender,
            avatarId: avatarId || undefined,
            isDeleted,
            createdAt,
            updatedAt,
            homeLocationLat: isNaN(homeLocationLat as number) ? null : homeLocationLat,
            homeLocationLng: isNaN(homeLocationLng as number) ? null : homeLocationLng,
            userMeasurement: userMeasurement || undefined,
          }
        });
        userCount++;
      } catch (err) {
        console.error(`❌ Failed to seed User id=${id}:`, err);
      }
    }
    console.log(`✅ Seeded ${userCount} User records.`);

    // 5. Seed CosmeticProduct table
    console.log("💄 Seeding CosmeticProduct table...");
    const cosmeticLines = readCSVFile("cosmeticproduct.csv");
    let cosmeticCount = 0;
    for (const line of cosmeticLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 2) continue;
      const id = fields[0];
      const name = trimQuotes(fields[1]);
      const brand = fields[2] ? trimQuotes(fields[2]) : null;
      const details = fields[3] ? trimQuotes(fields[3]) : null;
      const metaData = fields[4] ? parseJSONField(fields[4]) : null;
      const type = fields[5] ? (trimQuotes(fields[5]) as any) : null;
      const createdAt = fields[6] ? new Date(fields[6]) : new Date();
      const updatedAt = fields[7] ? new Date(fields[7]) : new Date();
      const fileUrlId = fields[8] ? trimQuotes(fields[8]) : null;

      let finish: any = null;
      if (metaData && metaData.finish) {
        const fVal = Array.isArray(metaData.finish) ? metaData.finish[0] : metaData.finish;
        if (fVal === "Matte") finish = "MATTE";
        else if (fVal === "Dewy") finish = "DEWY";
        else if (fVal === "Natural") finish = "NATURAL";
      }

      try {
        await prisma.cosmeticProduct.create({
          data: {
            id,
            name,
            brand,
            details,
            metaData: metaData || undefined,
            type: type || undefined,
            createdAt,
            fileUrlId: fileUrlId || undefined,
            finish: finish || undefined,
          }
        });
        cosmeticCount++;
      } catch (err) {
        console.error(`❌ Failed to seed CosmeticProduct id=${id}:`, err);
      }
    }
    console.log(`✅ Seeded ${cosmeticCount} CosmeticProduct records.`);

    // 6. Seed Garment table
    console.log("👕 Seeding Garment table...");
    const garmentLines = readCSVFile("Garment.csv");
    let garmentCount = 0;
    for (const line of garmentLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 5) continue;
      const id = fields[0];
      const name = trimQuotes(fields[1]);
      const description = fields[2] ? trimQuotes(fields[2]) : null;
      const imageUrl = trimQuotes(fields[3]);
      const fileId = trimQuotes(fields[4]);
      const garmentType = parseArrayField(fields[5]) as any[];
      const category = parseArrayField(fields[6]) as any[];
      const gender = (fields[7] ? trimQuotes(fields[7]) : "UNISEX") as any;
      const layerLevel = (fields[8] ? trimQuotes(fields[8]) : "BASE") as any;
      const metaData = fields[9] ? parseJSONField(fields[9]) : null;
      const createdAt = fields[10] ? new Date(fields[10]) : new Date();
      const updatedAt = fields[11] ? new Date(fields[11]) : new Date();
      const fittingSlot = parseArrayField(fields[12]) as any[];
      const silhouette = (fields[13] ? trimQuotes(fields[13]) : "Regular") as any;
      const userId = fields[14] ? trimQuotes(fields[14]) : null;

      try {
        await prisma.garment.create({
          data: {
            id,
            name,
            description,
            imageUrl,
            fileId,
            garmentType,
            category,
            gender,
            layerLevel,
            metaData: metaData || undefined,
            createdAt,
            updatedAt,
            fittingSlot,
            silhouette,
            userId: userId || undefined,
          }
        });
        garmentCount++;
      } catch (err) {
        console.error(`❌ Failed to seed Garment id=${id}:`, err);
      }
    }
    console.log(`✅ Seeded ${garmentCount} Garment records.`);

    // 7. Seed Outfit table
    console.log("👗 Seeding Outfit table...");
    const outfitLines = readCSVFile("Outfit.csv");
    let outfitCount = 0;
    for (const line of outfitLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 7) continue;
            const id = fields[0];
      const userId = fields[1] ? trimQuotes(fields[1]) : null;
      const name = trimQuotes(fields[2]);
      const description = fields[3] ? trimQuotes(fields[3]) : null;
      const createdAt = fields[4] ? new Date(fields[4]) : new Date();
      const updatedAt = fields[5] ? new Date(fields[5]) : new Date();
      const fileId = trimQuotes(fields[6]);
      const metaData = fields[7] ? parseJSONField(fields[7]) : null;
      const designType = (fields[8] ? trimQuotes(fields[8]) : "systemDesign") as any;
      const isPublic = fields[9] === "t";
      const userOutlineId = fields[10] ? trimQuotes(fields[10]) : null;
      const isDeleted = fields[11] === "t";

      try {
        await prisma.outfit.create({
          data: {
            id,
            description,
            name,
            userId: userId || undefined,
            createdAt,
            updatedAt,
            fileId,
            metaData: metaData || undefined,
            designType,
            isPublic,
            userOutlineId: userOutlineId || undefined,
            isDeleted,
          }
        });
        outfitCount++;
      } catch (err) {
        console.error(`❌ Failed to seed Outfit id=${id}:`, err);
      }
    }
    console.log(`✅ Seeded ${outfitCount} Outfit records.`);

    // 8. Seed GarmentInOutfit table
    console.log("🔗 Seeding GarmentInOutfit table...");
    let garmentInOutfitLines = readCSVFile("garmentinoutfit.csv");
    if (garmentInOutfitLines.length === 0) {
      garmentInOutfitLines = readCSVFile("Garmentonoutfit.csv");
    }
    let garmentInOutfitCount = 0;
    for (const line of garmentInOutfitLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 3) continue;
      const id = fields[0];
      const garmentId = trimQuotes(fields[1]);
      const outfitId = trimQuotes(fields[2]);
      const createdAt = fields[3] ? new Date(fields[3]) : new Date();
      const layerLevel = fields[4] ? (trimQuotes(fields[4]) as any) : null;
      const slot = fields[5] ? (trimQuotes(fields[5]) as any) : null;

      try {
        await prisma.garmentInOutfit.create({
          data: {
            id,
            garmentId,
            outfitId: outfitId || undefined,
            createdAt,
            layerLevel: layerLevel || undefined,
            slot: slot || undefined,
          }
        });
        garmentInOutfitCount++;
      } catch (err) {
        console.error(`❌ Failed to seed GarmentInOutfit id=${id}:`, err);
      }
    }
    console.log(`✅ Seeded ${garmentInOutfitCount} GarmentInOutfit records.`);

    // 9. Seed UserOutline table
    console.log("📅 Seeding UserOutline table...");
    const outlineLines = readCSVFile("UserOutline.csv");
    let outlineCount = 0;
    for (const line of outlineLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 2) continue;
      
      const id = fields[0];
      const userId = cleanOptionalString(fields[1]);
      const location = cleanOptionalString(fields[2]);
      
      const startTimeVal = cleanOptionalString(fields[3]);
      const startTime = startTimeVal ? new Date(startTimeVal) : null;
      
      const calendarId = cleanOptionalString(fields[4]);
      const createdAt = fields[5] && cleanOptionalString(fields[5]) ? new Date(fields[5]) : new Date();
      const updatedAt = fields[6] && cleanOptionalString(fields[6]) ? new Date(fields[6]) : new Date();
      
      const deletedAtVal = cleanOptionalString(fields[7]);
      const deletedAt = deletedAtVal ? new Date(deletedAtVal) : null;
      
      const conversationId = cleanOptionalString(fields[8]);
      const userPrompt = fields[9] ? parseArrayField(fields[9]) : [];
      
      const latitudeVal = cleanOptionalString(fields[10]);
      const latitude = latitudeVal ? parseFloat(latitudeVal) : null;
      
      const longitudeVal = cleanOptionalString(fields[11]);
      const longitude = longitudeVal ? parseFloat(longitudeVal) : null;

      try {
        await prisma.userOutline.create({
          data: {
            id,
            userId: userId || undefined,
            conversationId: conversationId || undefined,
            location,
            latitude: isNaN(latitude as number) ? null : latitude,
            longitude: isNaN(longitude as number) ? null : longitude,
            createdAt,
            updatedAt,
            deletedAt,
            calendarId: calendarId || undefined,
            userPrompt,
            startTime,
          }
        });
        outlineCount++;
      } catch (err) {
        console.error(`❌ Failed to seed UserOutline id=${id}:`, err);
      }
    }
    console.log(`✅ Seeded ${outlineCount} UserOutline records.`);

    // 10. Link Garments to Tags using raw implicit join inserts
    console.log("🔗 Linking Garments to Tags...");
    let linkLines = readCSVFile("garment_to_tag.csv");
    if (linkLines.length === 0) {
      linkLines = readCSVFile("GarmentToTag.csv");
    }

    const dbGarmentIds = new Set((await prisma.garment.findMany({ select: { id: true } })).map(g => g.id));
    const dbTagIds = new Set((await prisma.tag.findMany({ select: { id: true } })).map(t => t.id));

    const validLinks: { garmentId: string; tagId: string }[] = [];
    for (const line of linkLines) {
      const fields = parseCSVLine(line);
      if (fields.length < 2) continue;
      const garmentId = trimQuotes(fields[0]);
      const tagId = trimQuotes(fields[1]);

      if (dbGarmentIds.has(garmentId) && dbTagIds.has(tagId)) {
        validLinks.push({ garmentId, tagId });
      }
    }

    console.log(`Found ${validLinks.length} valid Garment-to-Tag relationships.`);
    
    let linkedCount = 0;
    const chunkSize = 100;
    for (let i = 0; i < validLinks.length; i += chunkSize) {
      const chunk = validLinks.slice(i, i + chunkSize);
      const values = chunk.map(link => `('${link.garmentId}', '${link.tagId}')`).join(",");
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "_GarmentToTag" ("A", "B") VALUES ${values} ON CONFLICT DO NOTHING;`
        );
        linkedCount += chunk.length;
      } catch (err) {
        // Fallback to individual inserts if chunk insertion encounters any issue
        for (const link of chunk) {
          try {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "_GarmentToTag" ("A", "B") VALUES ('${link.garmentId}', '${link.tagId}') ON CONFLICT DO NOTHING;`
            );
            linkedCount++;
          } catch (e) {
            console.error(`❌ Failed to link Garment id=${link.garmentId} to Tag id=${link.tagId}:`, e);
          }
        }
      }
    }
    console.log(`✅ Successfully linked ${linkedCount} Garment-to-Tag records.`);

    console.log("🎉 Database catalog population completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
