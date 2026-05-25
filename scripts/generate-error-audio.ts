import { PollyClient, SynthesizeSpeechCommand, Engine, VoiceId, OutputFormat } from "@aws-sdk/client-polly";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load env vars directly for the script
dotenv.config();

const AWS_VOICE_REGION = process.env.AWS_VOICE_REGION || "ap-southeast-1";
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";

const pollyClient = new PollyClient({
  region: AWS_VOICE_REGION,
  credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
});

async function generateErrorAudio() {
  const text = "I'm having trouble connecting to the network right now. Please check the connection and try again.";
  console.log(`Generating fallback audio for: "${text}"`);
  
  const cmd = new SynthesizeSpeechCommand({
    // Available Generative Voices: Matthew (Male), Ruth (Female), Stephen (Male)
    // Available Neural Voices (requires Engine.NEURAL): Joanna, Salli, Kendra, Kimberly, Justin, Joey
    Engine: Engine.GENERATIVE,
    LanguageCode: "en-US",
    VoiceId: VoiceId.Matthew,
    OutputFormat: OutputFormat.MP3,
    Text: text,
  });

  try {
    const res = await pollyClient.send(cmd);
    if (!res.AudioStream) throw new Error("No audio stream returned");
    
    const chunks: Uint8Array[] = [];
    // @ts-ignore
    for await (const chunk of res.AudioStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    const dir = path.join(__dirname, "../src/assets");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const filePath = path.join(dir, "error-fallback.mp3");
    fs.writeFileSync(filePath, buffer);
    console.log(`Successfully saved fallback audio to: ${filePath}`);
  } catch (err) {
    console.error("Failed to generate audio:", err);
  }
}

generateErrorAudio();
