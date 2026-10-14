import fs from "fs";
import path from "path";
import { z } from "zod";
import { GeminiProvider } from "../src/lib/ai/providers/gemini";
import { GroqProvider } from "../src/lib/ai/providers/groq";

// Manually load .env.local if present
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  const lines = fs.readFileSync(envLocalPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[k]) {
        process.env[k] = v;
      }
    }
  }
}

const smokeSchema = z.object({
  status: z.literal("ok"),
  greeting: z.string(),
  model_understood: z.string(),
});

async function main() {
  console.log("=================================================");
  console.log(" Running LLM Live Smoke Test (Gemini & Groq)");
  console.log("=================================================");

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  console.log(`GEMINI_API_KEY present: ${Boolean(geminiKey && geminiKey.trim())}`);
  console.log(`GROQ_API_KEY present:   ${Boolean(groqKey && groqKey.trim())}`);
  console.log(`GEMINI_MODEL:           ${process.env.GEMINI_MODEL || "gemini-2.5-flash"}`);
  console.log(`GROQ_MODEL:             ${process.env.GROQ_MODEL || "llama-3.3-70b-versatile"}\n`);

  let geminiSuccess = false;
  let groqSuccess = false;

  // 1. Test Gemini
  if (geminiKey && geminiKey.trim()) {
    console.log("--> Testing Gemini...");
    const gemini = new GeminiProvider();
    try {
      const response = await gemini.complete(
        "You are a system health check agent. Return JSON matching: { status: 'ok', greeting: string, model_understood: string }",
        "Say hello and confirm you are ready.",
        true
      );
      console.log(`Raw response (${response.latencyMs}ms):`, response.rawText);
      let cleaned = response.rawText.trim();
      if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
      if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
      if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
      const parsed = smokeSchema.parse(JSON.parse(cleaned.trim()));
      console.log(" Gemini verification passed! Output:", parsed);
      geminiSuccess = true;
    } catch (err) {
      console.error(" Gemini smoke test failed:", err instanceof Error ? err.message : err);
    }
  } else {
    console.log("Gemini test skipped: GEMINI_API_KEY not found in environment or .env.local");
  }

  // 2. Test Groq
  if (groqKey && groqKey.trim()) {
    console.log("\n--> Testing Groq...");
    const groq = new GroqProvider();
    try {
      const response = await groq.complete(
        "You are a system health check agent. Return JSON matching: { status: 'ok', greeting: string, model_understood: string }",
        "Say hello and confirm you are ready.",
        true
      );
      console.log(`Raw response (${response.latencyMs}ms):`, response.rawText);
      let cleaned = response.rawText.trim();
      if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
      if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
      if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
      const parsed = smokeSchema.parse(JSON.parse(cleaned.trim()));
      console.log(" Groq verification passed! Output:", parsed);
      groqSuccess = true;
    } catch (err) {
      console.error(" Groq smoke test failed:", err instanceof Error ? err.message : err);
    }
  } else {
    console.log("Groq test skipped: GROQ_API_KEY not found in environment or .env.local");
  }

  console.log("\n=================================================");
  console.log(`Summary: Gemini=${geminiSuccess ? "PASS" : "SKIPPED/FAILED"}, Groq=${groqSuccess ? "PASS" : "SKIPPED/FAILED"}`);
  console.log("=================================================");

  if (!geminiKey && !groqKey) {
    console.log("\nNotice: Provide keys in .env.local to run live tests.");
  }
}

main().catch((err) => {
  console.error("Smoke test script crashed:", err);
  process.exit(1);
});
