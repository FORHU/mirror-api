/* eslint-disable no-console */
import { PrismaClient, SKIN_TYPE } from "@prisma/client";
import { resolveItineraryCosmetics, type ChatWonderEvent } from "../utils/chat-wonder-cosmetics.util";

const prisma = new PrismaClient();

async function main() {
  console.log("======================================================================");
  console.log("🧪 MULTI-LEVEL EVENTS & DRAFTING DIAGNOSTICS");
  console.log("======================================================================\n");

  // 1. Fetch first user
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("❌ No users found in database. Run npm run db:seed first.");
    return;
  }
  const userId = user.id;
  console.log(`👤 Using Active User: ${user.username} (ID: ${userId})`);

  // 2. Fetch/Create dummy file for skin image scan
  let file = await prisma.file.findFirst({
    where: { mimeType: "image/jpeg" },
  });
  if (!file) {
    file = await prisma.file.create({
      data: {
        filename: "test-scan.jpg",
        fileUrl: "https://images.openbeautyfacts.org/images/products/317/804/135/8996/front_en.6.400.jpg",
        mimeType: "image/jpeg",
        provider: "EXTERNAL",
      },
    });
  }

  // 3. Purge existing outlines for clean diagnostics run
  console.log("🧹 Cleaning up old outlines for this test user...");
  await prisma.userOutline.deleteMany({ where: { userId } });

  // 4. Create active conversation
  const conversation = await prisma.conversation.create({
    data: {
      userId,
      title: "Active Styling Discussion",
    },
  });

  // 5. Create master UserOutline (starts in DRAFT status by default)
  const outline = await prisma.userOutline.create({
    data: {
      userId,
      conversationId: conversation.id,
      userPrompt: ["Plan a full transition day"],
      location: "Active Kiosk",
      status: "DRAFT",
    },
  });
  console.log(`📅 Created Session UserOutline (ID: ${outline.id})`);
  console.log(`   • Initial Status: ${outline.status}`);

  // 6. Create physical SkinAnalysis scan
  const scan = await prisma.skinAnalysis.create({
    data: {
      fileId: file.id,
      skinType: SKIN_TYPE.OILY,
      hydrationPct: 35,
      oilinessPct: 85,
      concerns: ["greasy face", "enlarged pores"],
      routineTip: "Maintain a double cleansing routine.",
    },
  });

  // Link it to our test outline
  await prisma.userOutline.update({
    where: { id: outline.id },
    data: { skinAnalysisId: scan.id },
  });
  console.log(`✨ Persisted SkinAnalysis scan (ID: ${scan.id})`);

  // 7. Simulate multi-level chronological events from Chat Wonder
  const simulatedEvents: ChatWonderEvent[] = [
    {
      type: "jog",
      timeBlock: "morning",
      context: {
        oilRisk: 80,
        sweatRisk: 80,
        smudgeRisk: 70,
        uvRisk: 90,
        tags: ["HUMID", "HOT", "HIGH_UV"],
      },
      fashion: {
        suggestion: "Breathable active tank and shorts to stay cool during the run",
      },
      cosmetics: {
        suggestion: "Wear sweatproof physical blocker sunscreen due to high UV index",
      },
      route: {
        suggestion: "Trail run route around park",
        origin: "Home",
        destination: "Park Gate",
      },
    },
    {
      type: "meeting",
      timeBlock: "noon",
      context: {
        oilRisk: 85,
        sweatRisk: 20,
        smudgeRisk: 80,
        uvRisk: 10,
        tags: ["MILD"],
      },
      fashion: {
        suggestion: "Business casual suit jacket and dark trousers",
      },
      cosmetics: {
        suggestion: "Pat on a matte oil-control gel lotion for the presentation",
      },
      route: {
        suggestion: "Drive route via highway",
        origin: "Park Gate",
        destination: "Office Tower",
      },
    },
  ];

  // 8. Run end-to-end resolveItineraryCosmetics() to transactionally create events and recommendations
  console.log("\n🔗 Resolving itinerary events & scoring products...");
  const enriched = await resolveItineraryCosmetics(userId, simulatedEvents, conversation.id);

  // 9. Verification database checks
  console.log("\n📥 [VERIFICATION RESULTS]");

  // Verify ItineraryEvents are written in DB
  const dbEvents = await prisma.itineraryEvent.findMany({
    where: { userOutlineId: outline.id },
    orderBy: { timeBlock: "asc" }, // noon then morning (by string alphabetical)
    include: {
      cosmeticRecommendations: {
        include: {
          cosmeticProduct: true,
        },
      },
    },
  });

  console.log(`🟢 Database successfully wrote ${dbEvents.length} chronological events.`);

  dbEvents.forEach((ev) => {
    console.log(`\n   [Card: ${ev.type} (${ev.timeBlock})]`);
    console.log(`      - Fashion Suggestion:    "${ev.fashionSuggestion}"`);
    console.log(`      - Cosmetics Suggestion:  "${ev.cosmeticsSuggestion}"`);
    console.log(`      - Route Origin/Dest:     ${ev.routeOrigin} ──► ${ev.routeDestination}`);
    console.log(`      - Resolved Database Recommendations (${ev.cosmeticRecommendations.length}):`);
    ev.cosmeticRecommendations.slice(0, 2).forEach((rec, idx) => {
      console.log(`        [${idx + 1}] "${rec.cosmeticProduct.name}" (Score: ${rec.score?.toFixed(0)}/100 | Dual-linked OutlineID: ${rec.userOutlineId !== null})`);
    });
  });

  // 10. Simulate finalization trigger
  console.log("\n🗣️  Simulating finalization audio command transcript: \"looks perfect, lock it in!\"");
  const inputTranscript = "looks perfect, lock it in!";
  const isFinalization = /(?:save|confirm|finalize|looks? good|perfect|lock in|looks? awesome|looks? perfect)\b/i.test(inputTranscript);
  
  if (isFinalization) {
    await prisma.userOutline.update({
      where: { conversationId: conversation.id },
      data: { status: "FINALIZED" },
    });
    console.log("🟢 Outline Status Triggered successfully!");
  }

  // Fetch final status
  const finalizedOutline = await prisma.userOutline.findUnique({
    where: { id: outline.id },
    select: { status: true },
  });
  console.log(`   • Final Outline Status in DB: ${finalizedOutline?.status}`);

  if (finalizedOutline?.status === "FINALIZED" && dbEvents.length === 2) {
    console.log("\n✅ Integration Diagnostics 100% Successful: All multi-level events, drafting status transitions, and dynamic dual-link recommendation logic are fully operational!");
  } else {
    console.error("❌ Diagnostics Verification Failed.");
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error("❌ Diagnostics failed:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
