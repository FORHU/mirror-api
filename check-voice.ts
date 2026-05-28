import { PollyClient, DescribeVoicesCommand } from "@aws-sdk/client-polly";
import * as dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const awsCredentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
};

const AWS_VOICE_REGION = process.env.AWS_REGION || "ap-southeast-1";

async function checkVoiceConnections() {
  console.log("=== Checking Voice Connections ===");
  
  // 1. Check AWS Connection (Polly)
  console.log(`\n1. Checking AWS Connection (${AWS_VOICE_REGION})...`);
  try {
    const pollyClient = new PollyClient({ region: AWS_VOICE_REGION, credentials: awsCredentials });
    const cmd = new DescribeVoicesCommand({ LanguageCode: "en-US" });
    const response = await pollyClient.send(cmd);
    console.log(`✅ AWS Connection Successful. Found ${response.Voices?.length} en-US voices.`);
  } catch (error: any) {
    console.error(`❌ AWS Connection Failed:`, error.message);
  }

  // 2. Check ChatWonder API
  const chatWonderUrl = process.env.CHAT_WONDER_API_URL;
  console.log(`\n2. Checking ChatWonder API (${chatWonderUrl})...`);
  if (!chatWonderUrl) {
    console.error("❌ CHAT_WONDER_API_URL is missing in .env");
  } else {
    try {
      // Just ping the base URL or health endpoint if it exists. 
      // We'll just do a GET request and catch 404/405/200 as successful connection.
      const res = await axios.get(`${chatWonderUrl}/docs`, { timeout: 5000 });
      console.log(`✅ ChatWonder API Reachable (Status: ${res.status})`);
    } catch (error: any) {
      if (error.response) {
        console.log(`✅ ChatWonder API Reachable (Responded with status: ${error.response.status})`);
      } else {
        console.error(`❌ ChatWonder API Unreachable:`, error.message);
      }
    }
  }
}

checkVoiceConnections().then(() => console.log("\nDone."));
