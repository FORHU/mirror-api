import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const CSV_DIR = "C:\\Users\\devrm\\Documents\\mirror-api";

function readCSVFile(filename: string): string[] {
  const filePath = path.join(CSV_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ File ${filename} not found in ${CSV_DIR}`);
    return [];
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return content.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let isJSONOrArrayField = false;
  const braceDepth = 0;
  const bracketDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      const isOpening = i === 0 || line[i - 1] === ",";
      const isClosing = i === line.length - 1 || line[i + 1] === ",";
      if (isOpening && !inQuotes) {
        inQuotes = true;
        isJSONOrArrayField = true;
      } else if (isClosing && inQuotes) {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function trimQuotes(str: string): string {
  if (!str) return "";
  let s = str.trim();
  while ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

async function main() {
  console.log("🔍 Checking first few lines of Garment.csv...");
  const lines = readCSVFile("Garment.csv");
  if (lines.length === 0) {
    console.log("❌ Garment.csv is empty or missing.");
    return;
  }

  console.log(`Loaded ${lines.length} lines. Testing first garment...`);
  const line = lines[0];
  console.log("Raw Line:", line);

  const fields = parseCSVLine(line);
  console.log("Parsed fields:", fields);

  if (fields.length < 5) {
    console.log(`❌ Line has only ${fields.length} fields, expected at least 5.`);
    return;
  }

  const id = fields[0];
  const name = trimQuotes(fields[1]);
  const description = fields[2] ? trimQuotes(fields[2]) : null;
  const imageUrl = trimQuotes(fields[3]);
  const fileId = trimQuotes(fields[4]);
  const userId = fields[14] ? trimQuotes(fields[14]) : null;

  console.log("\nEnriching properties...");
  console.log("Garment ID:", id);
  console.log("Name:", name);
  console.log("Image URL:", imageUrl);
  console.log("File ID:", fileId);
  console.log("User ID:", userId);

  try {
    const fileExists = await prisma.file.findUnique({ where: { id: fileId } });
    if (!fileExists) {
      console.log(`📁 File ID "${fileId}" does not exist, creating placeholder...`);
      await prisma.file.create({
        data: {
          id: fileId,
          filename: `${name.replace(/[^a-zA-Z0-9]/g, "_")}_image.jpg`,
          fileUrl: imageUrl || "https://placeholder.jpg",
          mimeType: "image/jpeg",
          provider: "EXTERNAL",
        },
      });
    }

    console.log("👕 Attempting prisma.garment.create...");
    await prisma.garment.create({
      data: {
        id,
        name,
        description,
        imageUrl,
        fileId,
        garmentType: [],
        category: [],
        gender: "UNISEX",
        layerLevel: "BASE",
        fittingSlot: [],
        silhouette: "Regular",
        userId: userId || undefined,
      },
    });
    console.log("✅ Success! Seeding works fine.");
  } catch (err: any) {
    console.error("❌ Failed to seed garment:", err);
  }

  await prisma.$disconnect();
}

main();
