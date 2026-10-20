import "./load-env";
import { z } from "zod";
import { OpenCodeProvider } from "../src/lib/ai/providers/opencode";
import { GeminiProvider } from "../src/lib/ai/providers/gemini";
import { GroqProvider } from "../src/lib/ai/providers/groq";
import type { LLMProvider } from "../src/lib/ai/types";

const smokeSchema = z.object({
  status: z.literal("ok"),
  greeting: z.string(),
  model_understood: z.string(),
});

async function smoke(provider: LLMProvider): Promise<"PASS" | "FAILED" | "SKIPPED"> {
  if (!provider.isAvailable()) {
    console.log(`${provider.name} test skipped: no API key in environment or .env.local`);
    return "SKIPPED";
  }
  console.log(`\n--> Testing ${provider.name} (${provider.getModel() || "(model unset)"})...`);
  try {
    const response = await provider.complete(
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
    console.log(` ${provider.name} verification passed! Output:`, parsed);

    // Streaming is used by the chat route, so check it too
    let streamed = "";
    for await (const chunk of provider.stream("Reply in one short sentence.", [{ role: "user", content: "Say hi." }])) {
      streamed += chunk;
    }
    if (!streamed.trim()) throw new Error("stream returned no text");
    console.log(` ${provider.name} stream passed: ${streamed.trim()}`);
    return "PASS";
  } catch (err) {
    console.error(` ${provider.name} smoke test failed:`, err instanceof Error ? err.message : err);
    return "FAILED";
  }
}

async function main() {
  console.log("=================================================");
  console.log(" Running LLM Live Smoke Test (OpenCode Go, Gemini, Groq)");
  console.log("=================================================");

  const providers: LLMProvider[] = [new OpenCodeProvider(), new GeminiProvider(), new GroqProvider()];
  const results: string[] = [];
  for (const provider of providers) {
    results.push(`${provider.name}=${await smoke(provider)}`);
  }

  console.log("\n=================================================");
  console.log(`Summary: ${results.join(", ")}`);
  console.log("=================================================");
}

main().catch((err) => {
  console.error("Smoke test script crashed:", err);
  process.exit(1);
});
