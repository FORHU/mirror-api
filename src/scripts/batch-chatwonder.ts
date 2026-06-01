/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const INPUT_FILE = path.resolve(__dirname, "../mocks/product.actual_products.json");
const OUTPUT_FILE = path.resolve(__dirname, "../mocks/chatwonder-results.json");
const CHAT_WONDER_API_URL = process.env.CHAT_WONDER_API_URL || "";
const BATCH_SIZE = 100;
const CDN_BASE = "https://d1bdogktone6hj.cloudfront.net/";

function extractS3Key(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith(CDN_BASE)) return url.slice(CDN_BASE.length);
  try {
    return new URL(url).pathname.slice(1);
  } catch {
    return null;
  }
}

async function callChatWonder(frontKey: string, backKey: string | null) {
  const body: Record<string, string> = { front_s3_key: frontKey };
  if (backKey) body.back_s3_key = backKey;
  const res = await axios.post(`${CHAT_WONDER_API_URL}/api/cosmetics/scan`, body, { timeout: 30_000 });
  return res.data;
}

async function main() {
  if (!CHAT_WONDER_API_URL) {
    console.error("❌ CHAT_WONDER_API_URL is not set in your .env file.");
    process.exit(1);
  }

  // Parse --from <index> or --page <pageNum> (1-based, page size = BATCH_SIZE)
  const fromArg = process.argv.indexOf("--from");
  const pageArg = process.argv.indexOf("--page");
  const retryFailed = process.argv.includes("--retry-failed");
  let startIndex = 0;
  if (fromArg !== -1) {
    startIndex = parseInt(process.argv[fromArg + 1] ?? "0", 10);
  } else if (pageArg !== -1) {
    const pageNum = parseInt(process.argv[pageArg + 1] ?? "1", 10);
    startIndex = (pageNum - 1) * BATCH_SIZE;
  }
  if (startIndex > 0) {
    console.log(`⏩ Starting from index ${startIndex} (page ${Math.floor(startIndex / BATCH_SIZE) + 1})\n`);
  }
  if (retryFailed) {
    console.log(`🔁 --retry-failed: failed entries will be re-queued.\n`);
  }

  const products: any[] = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
  console.log(`📦 Loaded ${products.length} products from input.\n`);

  // Resume support — load existing results and skip already-processed IDs
  let results: any[] = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      results = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf-8"));
      console.log(`🔄 Resuming — ${results.length} already processed, skipping them.\n`);
    } catch {
      results = [];
    }
  }

  // When retrying failed entries, remove them from results so they get reprocessed
  if (retryFailed) {
    const before = results.length;
    results = results.filter((r: any) => r.status !== "failed");
    console.log(`🗑  Removed ${before - results.length} failed entries for retry.\n`);
  }
  const processedIds = new Set(results.map((r: any) => r.product_id));
  const pending = products.slice(startIndex).filter((p) => !processedIds.has(p.id));

  if (pending.length === 0) {
    console.log("✅ All products already processed. Nothing to do.");
    return;
  }

  const totalBatches = Math.ceil(pending.length / BATCH_SIZE);
  console.log(`⏳ ${pending.length} remaining → ${totalBatches} batch(es) of ${BATCH_SIZE}\n`);

  let globalIndex = products.indexOf(pending[0]);

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`${"─".repeat(60)}`);
    console.log(`🔁  Batch ${batchNum}/${totalBatches}  (${batch.length} products)`);
    console.log(`${"─".repeat(60)}`);

    const settled = await Promise.allSettled(
      batch.map(async (product) => {
        const idx = ++globalIndex;
        const frontKey = extractS3Key(product.imageUrl ?? product.fileUrlId);
        const backKey = extractS3Key(product.ingredientImageUrl);

        console.log(`  [${idx}] ${product.name} (${product.brand})`);
        if (frontKey) console.log(`      front : ${frontKey}`);
        if (backKey) console.log(`      back  : ${backKey}`);

        if (!frontKey) {
          console.log(`      ⚠️  skipped — no image URL`);
          return {
            product_id: product.id,
            name: product.name,
            brand: product.brand,
            category: product.category,
            type: product.type,
            front_s3_key: null,
            back_s3_key: backKey,
            status: "skipped",
            chatwonder: null,
          };
        }

        try {
          const chatwonder = await callChatWonder(frontKey, backKey);
          console.log(`      ✅ chatwonder ok`);
          return {
            product_id: product.id,
            name: product.name,
            brand: product.brand,
            category: product.category,
            type: product.type,
            front_s3_key: frontKey,
            back_s3_key: backKey,
            status: "success",
            chatwonder,
          };
        } catch (err: any) {
          const msg = err?.response?.data?.message ?? err?.message ?? "unknown error";
          console.log(`      ❌ chatwonder failed: ${msg}`);
          return {
            product_id: product.id,
            name: product.name,
            brand: product.brand,
            category: product.category,
            type: product.type,
            front_s3_key: frontKey,
            back_s3_key: backKey,
            status: "failed",
            error: msg,
            chatwonder: null,
          };
        }
      })
    );

    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), "utf-8");
    console.log(`\n💾 Saved ${results.length} total results → ${OUTPUT_FILE}\n`);
  }

  const success = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  console.log("=".repeat(60));
  console.log("🏁  BATCH COMPLETE");
  console.log("=".repeat(60));
  console.log(`  ✅ Success : ${success}`);
  console.log(`  ❌ Failed  : ${failed}`);
  console.log(`  ⚠️  Skipped : ${skipped}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
