import { cognitiveVoiceService } from "./src/services/shared/cognitive-voice.service";
import dotenv from "dotenv";

dotenv.config();

async function run() {
  const transcript = "Let's go to the map";
  const ctx = {
    currentPage: "/",
    gender: undefined,
    lat: 16.41,
    lng: 120.59,
    navigating: false,
    traffic: false,
    sessionId: "",
    language: "en-US",
  };

  console.log("Testing with prompt:", transcript);
  const { response } = await cognitiveVoiceService.ask(
    transcript,
    ctx as any,
    process.env.CHAT_WONDER_API_URL || ""
  );

  console.log("\n--- AI RESPONSE ---");
  console.log(JSON.stringify(response, null, 2));
}

run().catch(console.error);
