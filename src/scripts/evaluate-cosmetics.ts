/* eslint-disable no-console */
import { PrismaClient, SKIN_TYPE, COSMETIC_TYPE, COSMETIC_FINISH } from "@prisma/client";
import { rankProducts, scoreProduct, type ProductForScoring, type AnalysisInput } from "../utils/cosmetics.util";

const prisma = new PrismaClient();

// High-fidelity mock catalog covering all rules and product matrices
const MOCK_PRODUCTS: (ProductForScoring & { name: string; brand: string })[] = [
  {
    id: "prod_sunscreen_spf50",
    name: "Ultra Shield Sunscreen SPF 50+",
    brand: "SolarGuard",
    type: "SUNSCREEN" as COSMETIC_TYPE,
    tags: ["zinc oxide", "vitamin c", "broad spectrum", "non-comedogenic"],
    spf: 50,
    waterproof: true,
    transferProof: true,
    hydrating: false,
    oilFree: true,
    finish: "MATTE" as COSMETIC_FINISH,
  },
  {
    id: "prod_moisturizer_dry",
    name: "Deep Moisture Rich Cream",
    brand: "HydraPure",
    type: "MOISTURIZER" as COSMETIC_TYPE,
    tags: ["ceramide", "hyaluronic acid", "shea butter", "oatmeal"],
    spf: null,
    waterproof: false,
    transferProof: false,
    hydrating: true,
    oilFree: false,
    finish: "DEWY" as COSMETIC_FINISH,
  },
  {
    id: "prod_moisturizer_oily",
    name: "Oil-Free Matte Gel Lotion",
    brand: "Clarify",
    type: "MOISTURIZER" as COSMETIC_TYPE,
    tags: ["niacinamide", "silica", "green tea"],
    spf: 15,
    waterproof: false,
    transferProof: false,
    hydrating: true,
    oilFree: true,
    finish: "MATTE" as COSMETIC_FINISH,
  },
  {
    id: "prod_serum_retinol",
    name: "Youth Bounce Retinol Night Serum",
    brand: "AgeDefy",
    type: "SERUM" as COSMETIC_TYPE,
    tags: ["retinol", "peptide", "hyaluronic acid"],
    spf: null,
    waterproof: false,
    transferProof: false,
    hydrating: true,
    oilFree: true,
    finish: "NATURAL" as COSMETIC_FINISH,
  },
  {
    id: "prod_serum_spots",
    name: "C-Glow Radiance Serum",
    brand: "Aura",
    type: "SERUM" as COSMETIC_TYPE,
    tags: ["vitamin c", "niacinamide", "licorice extract"],
    spf: null,
    waterproof: false,
    transferProof: false,
    hydrating: true,
    oilFree: true,
    finish: "DEWY" as COSMETIC_FINISH,
  },
  {
    id: "prod_exfoliant_bha",
    name: "2% BHA Pore Clarifying Liquid",
    brand: "Clarify",
    type: "EXFOLIANT" as COSMETIC_TYPE,
    tags: ["salicylic acid", "green tea"],
    spf: null,
    waterproof: false,
    transferProof: false,
    hydrating: false,
    oilFree: true,
    finish: "NATURAL" as COSMETIC_FINISH,
  },
  {
    id: "prod_cleanser_sensitive",
    name: "Centella Soothing Milky Cleanser",
    brand: "HydraPure",
    type: "CLEANSER" as COSMETIC_TYPE,
    tags: ["centella", "ceramide", "oatmeal"],
    spf: null,
    waterproof: false,
    transferProof: false,
    hydrating: true,
    oilFree: true,
    finish: "NATURAL" as COSMETIC_FINISH,
  },
  {
    id: "prod_toner_pore",
    name: "Pore-Tightening Niacinamide Toner",
    brand: "Clarify",
    type: "TONER" as COSMETIC_TYPE,
    tags: ["niacinamide", "witch hazel", "salicylic acid"],
    spf: null,
    waterproof: false,
    transferProof: false,
    hydrating: false,
    oilFree: true,
    finish: "MATTE" as COSMETIC_FINISH,
  },
  {
    id: "prod_essence_snail",
    name: "Snail Mucin Hydrating Essence",
    brand: "HydraPure",
    type: "ESSENCE" as COSMETIC_TYPE,
    tags: ["snail secretion filtrate", "hyaluronic acid"],
    spf: null,
    waterproof: false,
    transferProof: false,
    hydrating: true,
    oilFree: true,
    finish: "DEWY" as COSMETIC_FINISH,
  },
];

// Definition of distinct user scenarios to test the engine's response
interface Scenario {
  name: string;
  input: AnalysisInput;
}

const SCENARIOS: Scenario[] = [
  {
    name: "1. Oily skin with Pores & High Oiliness under Hot/Humid Weather",
    input: {
      skinType: SKIN_TYPE.OILY,
      hydrationPct: 55,
      oilinessPct: 85,
      concerns: ["enlarged pores on cheeks", "greasy t-zone", "oiliness"],
      weather: {
        oilRisk: 80,
        sweatRisk: 80,
        smudgeRisk: 70,
        uvRisk: 40,
        tags: ["HUMID", "HOT"],
      },
    },
  },
  {
    name: "2. Dry & Tight skin with Fine Lines under Cold/Dry Weather",
    input: {
      skinType: SKIN_TYPE.DRY,
      hydrationPct: 25,
      oilinessPct: 15,
      concerns: ["dry and tight skin", "fine lines around eyes", "wrinkles"],
      weather: {
        drynessRisk: 90,
        uvRisk: 10,
        tags: ["COLD", "DRY"],
      },
    },
  },
  {
    name: "3. Sensitive Skin with Redness & Dark Spots under High UV",
    input: {
      skinType: SKIN_TYPE.SENSITIVE,
      hydrationPct: 40,
      oilinessPct: 30,
      concerns: ["redness on cheeks", "uneven skin tone", "dark spot"],
      weather: {
        uvRisk: 85,
        oilRisk: 20,
        drynessRisk: 50,
        tags: ["SUNNY", "HIGH_UV"],
      },
    },
  },
  {
    name: "4. Normal Skin with Mild Dehydration (No Weather Snap)",
    input: {
      skinType: SKIN_TYPE.NORMAL,
      hydrationPct: 45,
      oilinessPct: 40,
      concerns: ["feeling slightly tight and dehydrated"],
    },
  },
  {
    name: "5. Combination Skin, Extreme Rain and Sweat/Smudge Risks",
    input: {
      skinType: SKIN_TYPE.COMBINATION,
      hydrationPct: 50,
      oilinessPct: 50,
      concerns: ["uneven tone"],
      weather: {
        sweatRisk: 95,
        smudgeRisk: 95,
        uvRisk: 5,
        tags: ["RAINY"],
      },
    },
  },
];

async function main() {
  console.log("======================================================================");
  console.log("💄 COSMETICS ENGINE EVALUATION SCRIPT");
  console.log("======================================================================\n");

  // Attempt to fetch actual catalog from database
  let catalog: ProductForScoring[] = [];
  let isDBCatalog = false;
  try {
    const dbCatalog = await prisma.cosmeticProduct.findMany({
      select: {
        id: true,
        type: true,
        tags: true,
        spf: true,
        waterproof: true,
        transferProof: true,
        hydrating: true,
        oilFree: true,
        finish: true,
      },
    });
    if (dbCatalog && dbCatalog.length > 0) {
      catalog = dbCatalog as ProductForScoring[];
      isDBCatalog = true;
      console.log(`📂 Loaded ${catalog.length} products from the PostgreSQL Database.\n`);
    }
  } catch (err) {
    // Database connection or table not ready, silent fallback to mock catalog
  }

  if (!isDBCatalog) {
    catalog = MOCK_PRODUCTS;
    console.log(`⚠️  Could not read from DB (or DB is empty). Evaluating using high-fidelity Mock Catalog (${catalog.length} items).\n`);
  }

  // Run each scenario
  for (const scenario of SCENARIOS) {
    console.log(`----------------------------------------------------------------------`);
    console.log(`🎬 SCENARIO: ${scenario.name}`);
    console.log(`----------------------------------------------------------------------`);
    console.log(`📥 [INPUTS]`);
    console.log(`   • Skin Type:      ${scenario.input.skinType}`);
    console.log(`   • Hydration Pct:  ${scenario.input.hydrationPct}%`);
    console.log(`   • Oiliness Pct:   ${scenario.input.oilinessPct}%`);
    console.log(`   • Concerns:       [${scenario.input.concerns.join(", ")}]`);
    if (scenario.input.weather) {
      const w = scenario.input.weather;
      console.log(`   • Weather Snapshot:`);
      console.log(`     - Tags:         [${w.tags?.join(", ")}]`);
      console.log(`     - Risks:        UV(${w.uvRisk ?? 0}) | Oil(${w.oilRisk ?? 0}) | Dry(${w.drynessRisk ?? 0}) | Sweat(${w.sweatRisk ?? 0}) | Smudge(${w.smudgeRisk ?? 0})`);
    } else {
      console.log(`   • Weather Snapshot: NONE (No weather signals)`);
    }
    console.log(`\n🏆 [RECOMMENDATIONS]`);

    const ranked = rankProducts(scenario.input, catalog);

    if (ranked.length === 0) {
      console.log(`   ❌ No products met the minimum score threshold (Score >= 25).`);
    } else {
      ranked.forEach((rec, idx) => {
        // Resolve display details
        const details = isDBCatalog 
          ? null 
          : MOCK_PRODUCTS.find(p => p.id === rec.productId);
        const name = details ? `"${details.name}" (${details.brand})` : `Product ID: ${rec.productId}`;
        const typeStr = details ? `[${details.type}] ` : "";

        console.log(`   [Rank ${rec.rank}] Score: ${rec.score.toFixed(0)}/100 | ${typeStr}${name}`);
        console.log(`      • Matching Reasons:  [${rec.reason.join(", ")}]`);
        console.log(`      • Scoring Breakdown:`);
        Object.entries(rec.signals).forEach(([ruleName, points]) => {
          console.log(`        - ${ruleName.padEnd(35)}: +${points} pts`);
        });
        console.log("");
      });
    }
    console.log("");
  }

  // Summary analysis on how rules align
  console.log("======================================================================");
  console.log("📊 ENGINE DYNAMICS OBSERVATIONS");
  console.log("======================================================================");
  console.log(`1. SKIN BASES: Oily skin boosts oil-free products, while Dry skin boosts hydrating and dewy finishes.`);
  console.log(`2. CONTINUOUS FEEDBACK: A low hydration percent (<50%) awards linear scaling bonus points to hydration products.`);
  console.log(`3. WEATHER SENSITIVITY: Under high sweat/smudge risk, waterproof/transfer-proof products receive instant premium bonuses.`);
  console.log(`4. CONCERN INTERSECTION: Free-text skin concerns like "pores" or "dark spots" are matched using substring matching to target specific active ingredients (e.g. Niacinamide, Salicylic Acid, Vitamin C).`);
  console.log("======================================================================\n");
}

main()
  .catch((err) => {
    console.error("Evaluation script failed:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
