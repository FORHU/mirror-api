/**
 * Smoke test for POST /api/mirror/voice/process
 *
 * Sends a short spoken sentence encoded as 16kHz 16-bit mono PCM.
 * The audio spells out "Hello, can you help me navigate?" as a 440 Hz tone —
 * Whisper won't transcribe a tone, so expect a 422 (empty transcript) from
 * a sine wave. Use --real to test with a real .wav file instead.
 *
 * Usage:
 *   node scripts/test-voice.mjs                      # tone test (checks auth)
 *   node scripts/test-voice.mjs --real path/to/file.wav  # real audio test
 *   node scripts/test-voice.mjs http://192.168.x.x:3007  # custom host
 */

import { readFileSync } from "fs";

const args    = process.argv.slice(2);
const realIdx = args.indexOf("--real");
const BASE_URL = args.find(a => a.startsWith("http")) || "http://localhost:3007";

let body;
let label;

if (realIdx !== -1) {
  // --real path/to/file.wav  →  strip the 44-byte WAV header, send raw PCM
  const wavPath = args[realIdx + 1];
  if (!wavPath) { console.error("--real requires a path to a .wav file"); process.exit(1); }
  const wav = readFileSync(wavPath);
  body  = wav.slice(44);          // strip WAV header → raw PCM
  label = `${wavPath} (${body.length} bytes PCM)`;
} else {
  // Sine wave — just checks that the endpoint is up and AWS auth works
  const SAMPLE_RATE = 16000;
  const DURATION_S  = 2;
  const pcm = new Int16Array(SAMPLE_RATE * DURATION_S);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 16000);
  }
  body  = Buffer.from(pcm.buffer);
  label = `sine wave (${body.length} bytes PCM — expects 422 empty transcript)`;
}

console.log(`\nTesting: POST ${BASE_URL}/api/mirror/voice/process`);
console.log(`Audio:   ${label}\n`);

const res = await fetch(`${BASE_URL}/api/mirror/voice/process`, {
  method:  "POST",
  headers: { "Content-Type": "application/octet-stream" },
  body,
});

console.log("Status:", res.status, res.statusText);

const contentType = res.headers.get("content-type") ?? "";

if (res.status === 200) {
  const transcript = decodeURIComponent(res.headers.get("x-transcript") ?? "");
  const reply      = decodeURIComponent(res.headers.get("x-reply")      ?? "");
  const audioBytes = (await res.arrayBuffer()).byteLength;
  console.log("\n✅ Full pipeline OK!");
  console.log("   Transcript:", transcript);
  console.log("   Reply:     ", reply);
  console.log("   Audio:     ", audioBytes, "bytes MP3");
} else {
  const data = contentType.includes("json") ? await res.json() : await res.text();
  if (res.status === 422) {
    console.log("\n✅ AWS + OpenAI auth work — 422 expected for a sine wave (no speech detected).");
    console.log("   Run with --real <file.wav> or test in the browser for a full end-to-end check.");
  } else {
    console.log("\n❌ Error:", data);
    if (res.status === 500 && String(data).includes("HTTP/2")) {
      console.log("\n   Hint: This is the Node.js v24 / AWS Transcribe HTTP/2 bug.");
      console.log("   The service now uses OpenAI Whisper — restart the server and try again.");
    }
    if (res.status === 403 || String(data).includes("InvalidClientTokenId") || String(data).includes("UnrecognizedClientException")) {
      console.log("\n   Hint: IAM credentials are wrong or missing Polly permissions.");
      console.log("   Attach AmazonPollyReadOnlyAccess to your IAM user.");
    }
  }
}
