import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// Target active ingredients that our rule-matching engine looks for
const ACTIVE_INGREDIENTS = [
  { match: /niacinamide/i, tag: "niacinamide" },
  { match: /salicyl/i, tag: "salicylic acid" },
  { match: /retinol/i, tag: "retinol" },
  { match: /ceramide/i, tag: "ceramide" },
  { match: /hyaluronic/i, tag: "hyaluronic acid" },
  { match: /zinc\s*oxide/i, tag: "zinc oxide" },
  { match: /titanium\s*dioxide/i, tag: "titanium dioxide" },
  { match: /vitamin\s*c|ascorb/i, tag: "vitamin c" },
  { match: /centella|cica|asiaticoside/i, tag: "centella" },
  { match: /oatmeal|avena|colloidal\s*oat/i, tag: "oatmeal" },
  { match: /glycolic/i, tag: "glycolic acid" },
  { match: /peptide/i, tag: "peptide" },
  { match: /snail\s*secretion|snail\s*mucin/i, tag: "snail mucin" },
];

/**
 * Maps categories and name keywords to the strict "Core Taxonomy" enums.
 * If no core taxonomy category is matched, returns null to filter it out.
 */
function classifyCoreTaxonomy(
  rawCategories: string,
  rawName: string
): { category: any; type: any } | null {
  const text = `${rawCategories} ${rawName}`.toLowerCase();

  // 1. Strict Discard Filters for non-core taxonomy items
  if (
    /laundr|detergent|laine|adoucissant|vaisselle|nettoyage|cleaning|household|bleach|assouplissant/i.test(
      text
    )
  ) {
    return null; // Household chemical / laundry
  }
  if (/shampoo|conditioner|hair\s*dye|hair\s*color|apres-shampooing|cheveux/i.test(text)) {
    return null; // Haircare
  }
  if (/body\s*wash|shower\s*gel|savon\s*corps|body\s*scrub|deodorant|perfume|parfum|cologne|fragrance/i.test(text)) {
    return null; // Body / Hygiene / Fragrance
  }
  if (/nail\s*polish|vernis\s*a\s*ongles|ongle|nail\s*care/i.test(text)) {
    return null; // Nails
  }

  // 2. Map Core Skincare
  if (/sunscreen|sun\s*block|protection\s*solaire|spf|uv\s*shield/i.test(text)) {
    return { category: "SKINCARE", type: "SUNSCREEN" };
  }
  if (/moisturizer|moisturising|hydratant|cream|creme\s*hydratante|lotion\s*hydratante|emulsion/i.test(text)) {
    // If lip balm, map to LIPSTICK or MOISTURIZER? Since LIP_BALM is not in core taxonomy, it maps to MOISTURIZER
    if (/lip\s*balm|baume\s*levres/i.test(text)) {
      return { category: "SKINCARE", type: "MOISTURIZER" };
    }
    return { category: "SKINCARE", type: "MOISTURIZER" };
  }
  if (/serum|ampoule|concentre/i.test(text)) {
    return { category: "SKINCARE", type: "SERUM" };
  }
  if (/toner|tonique|lotion\s*tonique|refining\s*water/i.test(text)) {
    return { category: "SKINCARE", type: "TONER" };
  }
  if (/essence/i.test(text)) {
    return { category: "SKINCARE", type: "ESSENCE" };
  }
  if (/exfoliant|peel|peeling|scrub|gommage/i.test(text)) {
    return { category: "SKINCARE", type: "EXFOLIANT" };
  }
  if (/cleanser|facial\s*wash|nettoyant\s*visage|cleansing\s*gel|foam|mousse\s*nettoyante/i.test(text)) {
    return { category: "SKINCARE", type: "CLEANSER" };
  }

  // 3. Map Core Makeup
  // Lips
  if (/lipstick|rouge\s*a\s*levres/i.test(text)) {
    return { category: "LIPS", type: "LIPSTICK" };
  }
  if (/lip\s*gloss|brillant\s*a\s*levres|lipgloss/i.test(text)) {
    return { category: "LIPS", type: "LIP_GLOSS" };
  }
  if (/lip\s*tint|encre\s*a\s*levres/i.test(text)) {
    return { category: "LIPS", type: "LIP_TINT" };
  }
  // Face
  if (/foundation|fard\s*a\s*paupieres|bb\s*cream|cc\s*cream|fond\s*de\s*teint/i.test(text)) {
    return { category: "FACE", type: "FOUNDATION" };
  }
  if (/concealer|anti-cernes/i.test(text)) {
    return { category: "FACE", type: "CONCEALER" };
  }
  if (/powder|poudre/i.test(text)) {
    return { category: "FACE", type: "POWDER" };
  }
  if (/blush|fard\s*a\s*joues/i.test(text)) {
    return { category: "FACE", type: "BLUSH" };
  }
  if (/highlighter|enlumineur/i.test(text)) {
    return { category: "FACE", type: "HIGHLIGHTER" };
  }
  if (/contour/i.test(text)) {
    return { category: "FACE", type: "CONTOUR" };
  }
  if (/primer|base\s*de\s*teint/i.test(text)) {
    return { category: "FACE", type: "PRIMER" };
  }
  if (/setting\s*spray|fixateur/i.test(text)) {
    return { category: "FACE", type: "SETTING_SPRAY" };
  }
  // Eyes
  if (/eyeshadow|ombre\s*a\s*paupieres/i.test(text)) {
    return { category: "EYES", type: "EYESHADOW" };
  }
  if (/eyeliner|eye-liner/i.test(text)) {
    return { category: "EYES", type: "EYELINER" };
  }
  if (/mascara/i.test(text)) {
    return { category: "EYES", type: "MASCARA" };
  }
  if (/brow|sourcil/i.test(text)) {
    return { category: "EYES", type: "BROW" };
  }

  // Fallback if none of the core cosmetics are explicitly found in classification
  return null;
}

/**
 * Primary enrichment function to parse matching attributes
 */
function parseProductAttributes(raw: any) {
  const name = raw.product_name || "";
  const genericName = raw.generic_name || "";
  const combinedText = `${name} ${genericName}`.toLowerCase();

  // 1. Extract SPF
  let spf: number | null = null;
  const spfMatch = combinedText.match(/spf\s*(\d+)/i);
  if (spfMatch) {
    spf = parseInt(spfMatch[1], 10);
  }

  // 2. Extract Finish
  let finish: "MATTE" | "DEWY" | "NATURAL" | null = null;
  if (/matte|anti-shine|poreless|matifiant|brillance/i.test(combinedText)) {
    finish = "MATTE";
  } else if (/dewy|glow|radiant|hydra-glow|lumineux/i.test(combinedText)) {
    finish = "DEWY";
  } else if (/natural|invisible|sheer|naturel/i.test(combinedText)) {
    finish = "NATURAL";
  }

  // 3. Extract Ingredient Tags
  const activeTags: string[] = [];
  const ingredientsText = raw.ingredients_text || "";
  const ingredientsLower = ingredientsText.toLowerCase();

  for (const item of ACTIVE_INGREDIENTS) {
    if (item.match.test(ingredientsLower) || item.match.test(combinedText)) {
      activeTags.push(item.tag);
    }
  }

  // 4. Set Booleans
  const hydrating =
    /hydrat|moistur|water-rich|water-infuse|hyaluronic/i.test(combinedText) ||
    activeTags.includes("hyaluronic acid");
  const oilFree =
    /oil-free|non-comedogenic|sans huile|sebum-control|anti-sebum/i.test(combinedText) ||
    activeTags.includes("salicylic acid");
  const waterproof = /waterproof|water-resistant|résistant à l'eau/i.test(combinedText);
  const transferProof = /transferproof|sans transfert|longwear|long-lasting/i.test(combinedText);

  return {
    spf,
    finish,
    tags: activeTags,
    hydrating,
    oilFree,
    waterproof,
    transferProof,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("❌ Usage: npx ts-node src/scripts/import-openbeautyfacts.ts <path_to_json_file>");
    process.exit(1);
  }

  const filePath = path.resolve(args[0]);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ JSON file not found at path: ${filePath}`);
    process.exit(1);
  }

  console.log(`🚀 Reading raw Open Beauty Facts file: ${filePath}`);
  const fileContent = fs.readFileSync(filePath, "utf-8");
  
  let products: any[] = [];
  try {
    const parsed = JSON.parse(fileContent);
    products = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error("❌ Failed to parse JSON file structure:", err);
    process.exit(1);
  }

  console.log(`📦 Loaded ${products.length} records. Beginning classification & enrichment...`);
  
  let importedCount = 0;
  let skippedCount = 0;

  for (const raw of products) {
    const rawCode = raw.code ? String(raw.code.$numberLong || raw.code) : null;
    if (!rawCode) {
      console.warn("⚠️ Skipping record without barcode identifier.");
      skippedCount++;
      continue;
    }

    const name = raw.product_name || "Unknown Product";
    const categories = raw.categories_tags ? raw.categories_tags.toString() : "";

    // 1. Apply Core Taxonomy filtering
    const classification = classifyCoreTaxonomy(categories, name);
    if (!classification) {
      console.log(`⚠️ Skipping non-core / non-cosmetic product: "${name}" (Categories: "${categories}")`);
      skippedCount++;
      continue;
    }

    // 2. Perform enrichment parsing
    const attributes = parseProductAttributes(raw);
    const brand = raw.brands ? raw.brands.split(",")[0].trim() : "Unknown Brand";
    const details = raw.generic_name || raw.quantity ? `Quantity: ${raw.quantity || "N/A"}` : null;
    const fileId = `file_cosmetic_${rawCode}`;
    const imageUrl = raw.image_url || raw.image_small_url || null;

    try {
      await prisma.$transaction(async (tx) => {
        // A. Handle image reference file if it exists
        if (imageUrl) {
          await tx.file.upsert({
            where: { id: fileId },
            update: {
              filename: `${name.replace(/[^a-zA-Z0-9]/g, "_")}_image.jpg`,
              fileUrl: imageUrl,
            },
            create: {
              id: fileId,
              filename: `${name.replace(/[^a-zA-Z0-9]/g, "_")}_image.jpg`,
              fileUrl: imageUrl,
              mimeType: "image/jpeg",
              provider: "EXTERNAL",
            },
          });
        }

        // B. Upsert cosmetic product record
        await tx.cosmeticProduct.upsert({
          where: { id: `code_${rawCode}` },
          update: {
            name,
            brand,
            details,
            category: classification.category,
            type: classification.type,
            spf: attributes.spf,
            finish: attributes.finish,
            tags: attributes.tags,
            hydrating: attributes.hydrating,
            oilFree: attributes.oilFree,
            waterproof: attributes.waterproof,
            transferProof: attributes.transferProof,
            fileUrlId: imageUrl ? fileId : null,
            metaData: {
              raw_categories: categories,
              barcode: rawCode,
              openbeautyfacts_url: raw.url || null,
            },
          },
          create: {
            id: `code_${rawCode}`,
            name,
            brand,
            details,
            category: classification.category,
            type: classification.type,
            spf: attributes.spf,
            finish: attributes.finish,
            tags: attributes.tags,
            hydrating: attributes.hydrating,
            oilFree: attributes.oilFree,
            waterproof: attributes.waterproof,
            transferProof: attributes.transferProof,
            fileUrlId: imageUrl ? fileId : null,
            metaData: {
              raw_categories: categories,
              barcode: rawCode,
              openbeautyfacts_url: raw.url || null,
            },
          },
        });
      });

      console.log(`✅ Successfully enriched and imported: "${name}" as ${classification.category} -> ${classification.type}`);
      importedCount++;
    } catch (err) {
      console.error(`❌ Failed to persist product barcode=${rawCode} ("${name}"):`, err);
    }
  }

  console.log("\n=======================================================");
  console.log("🏁 INGESTION PIPELINE SUMMARY");
  console.log("=======================================================");
  console.log(`🎉 Enriched and Imported: ${importedCount} products`);
  console.log(`🗑️ Filtered & Skipped:     ${skippedCount} products`);
  console.log("=======================================================\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Fatal Ingestion Pipeline Error:", err);
  process.exit(1);
});
