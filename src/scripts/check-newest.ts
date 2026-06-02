/**
 * check-garments-raw.ts
 * ─────────────────────
 * Fires the [garments] persona directly against ChatWonder and logs
 * the full raw response so you can inspect exactly what the AI returns.
 *
 * Usage:
 *   npx ts-node --files src/scripts/check-garments-raw.ts
 */

import ChatWonderService from "../services/shared/chat-wonder.service";
import { streamChat } from "../utils/chat-wonder-stream";
import { parseChatWonderResponse } from "../utils/parse-chatWonder-response.util";

const TEST_INPUT = "[garments] suggest me a casual outfit for today";
const TEST_GENDER = "FEMALE";

async function main() {
  console.log("🔍  Requesting session from ChatWonder...");
  const sessionId = await ChatWonderService.generateChatSessionId("debug-user", true);
  console.log("   Session ID:", sessionId);

  const persona = ChatWonderService.getPersonaPrompt(TEST_INPUT, TEST_GENDER);
  console.log("\n📋  Persona being sent (first 300 chars):");
  console.log(persona?.slice(0, 300) + "...\n");

  let raw = "";
  console.log("📡  Streaming from ChatWonder...\n");

  await streamChat({
    userInput: TEST_INPUT,
    sessionId: sessionId as string,
    persona,
    documentContext: "",
    userHistorySelect: "",
    weather: {},
    callbacks: {
      onChunk: (chunk) => {
        raw += chunk;
        process.stdout.write(".");
      },
      onComplete: () => {
        console.log("\n\n✅  Stream complete.\n");
      },
      onError: (err) => {
        console.error("\n❌  Stream error:", err.message);
      },
    },
  });

  console.log("━━━━━━━━━━━━━━━━  RAW RESPONSE  ━━━━━━━━━━━━━━━━");
  console.log(raw);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Also show the parsed version
  const parsed = parseChatWonderResponse(raw);
  console.log("📦  PARSED  →  intent:", parsed.intent);
  console.log("   message:", parsed.message?.slice(0, 100));
  console.log("   sets:", parsed.sets?.length ?? 0, "set(s)");

  if (parsed.sets?.length) {
    console.log("\n🗂️  SETS DETAIL:");
    console.log(JSON.stringify(parsed.sets, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
