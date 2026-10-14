import fs from "fs";
import path from "path";
import { getEnv } from "@/lib/env";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { GeminiProvider } from "./providers/gemini";
import { GroqProvider } from "./providers/groq";
import { LocalProvider } from "./providers/local";
import type {
  CompleteOptions,
  LLMProvider,
  ProviderResponse,
  StreamOptions,
} from "./types";
import type { LLMPurpose } from "@/types";

export class LLMRouter {
  private providers: LLMProvider[];

  constructor(customProviders?: LLMProvider[]) {
    if (customProviders) {
      this.providers = customProviders;
    } else {
      this.providers = [
        new GeminiProvider(),
        new GroqProvider(),
        new LocalProvider(),
      ];
    }
  }

  private async logCall(params: {
    sessionId?: string | null;
    purpose: LLMPurpose;
    provider: string;
    model: string;
    promptVersion: string;
    latencyMs?: number;
    status: "ok" | "failover" | "error";
    errorCode?: string | null;
  }) {
    try {
      const db = getDb();
      const id = `llm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      await db.execute({
        sql: `INSERT INTO llm_calls (id, session_id, purpose, provider, model, prompt_version, latency_ms, status, error_code)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          params.sessionId || null,
          params.purpose,
          params.provider,
          params.model,
          params.promptVersion,
          params.latencyMs || null,
          params.status,
          params.errorCode || null,
        ],
      });
    } catch (err) {
      // Don't crash router on logging failure
      console.warn("Failed to log llm_call to database:", err);
    }
  }

  private getReplayFixture(purpose: LLMPurpose): unknown {
    const fixturePath = path.resolve(process.cwd(), `fixtures/llm/${purpose}.json`);
    if (!fs.existsSync(fixturePath)) {
      throw new AppError(
        "LLM_UNAVAILABLE",
        `Replay fixture not found for purpose '${purpose}' at fixtures/llm/${purpose}.json`
      );
    }
    const content = fs.readFileSync(fixturePath, "utf-8");
    return JSON.parse(content);
  }

  async complete<T>(options: CompleteOptions<T>): Promise<{ data: T; provider: string; model: string }> {
    const env = getEnv();

    // Replay mode (tests only)
    if (env.LLM_MODE === "replay") {
      const raw = this.getReplayFixture(options.purpose);
      const parsed = options.schema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError("LLM_INVALID_OUTPUT", `Replay fixture failed schema validation: ${parsed.error.message}`);
      }
      return { data: parsed.data, provider: "replay", model: "fixture" };
    }

    const availableProviders = this.providers.filter((p) => p.isAvailable());
    if (availableProviders.length === 0) {
      await this.logCall({
        sessionId: options.sessionId,
        purpose: options.purpose,
        provider: "none",
        model: "none",
        promptVersion: options.promptVersion,
        status: "error",
        errorCode: "NO_PROVIDERS_CONFIGURED",
      });
      throw new AppError("LLM_UNAVAILABLE", "No LLM providers are configured with active API keys.", 503);
    }

    let lastError: unknown = null;

    for (let i = 0; i < availableProviders.length; i++) {
      const provider = availableProviders[i];
      try {
        const response = await provider.complete(options.system, options.user, true);

        // Attempt JSON parse and validation
        const validated = await this.validateOrRepair(provider, options, response);

        await this.logCall({
          sessionId: options.sessionId,
          purpose: options.purpose,
          provider: provider.name,
          model: provider.getModel(),
          promptVersion: options.promptVersion,
          latencyMs: response.latencyMs,
          status: i > 0 ? "failover" : "ok",
        });

        return {
          data: validated,
          provider: provider.name,
          model: provider.getModel(),
        };
      } catch (err) {
        lastError = err;
        const errMessage = err instanceof Error ? err.message : String(err);

        // If it's an explicit validation/repair exhaustion, do not failover across providers if the output was unfixable
        if (err instanceof AppError && err.code === "LLM_INVALID_OUTPUT") {
          await this.logCall({
            sessionId: options.sessionId,
            purpose: options.purpose,
            provider: provider.name,
            model: provider.getModel(),
            promptVersion: options.promptVersion,
            status: "error",
            errorCode: "LLM_INVALID_OUTPUT",
          });
          throw err;
        }

        await this.logCall({
          sessionId: options.sessionId,
          purpose: options.purpose,
          provider: provider.name,
          model: provider.getModel(),
          promptVersion: options.promptVersion,
          status: i < availableProviders.length - 1 ? "failover" : "error",
          errorCode: errMessage.slice(0, 100),
        });

        console.warn(`Provider ${provider.name} failed: ${errMessage}. Trying fallback if available.`);
      }
    }

    throw new AppError(
      "LLM_UNAVAILABLE",
      `All available LLM providers failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      503
    );
  }

  private async validateOrRepair<T>(
    provider: LLMProvider,
    options: CompleteOptions<T>,
    response: ProviderResponse
  ): Promise<T> {
    let rawJson: unknown;
    let parseError: string | null = null;

    try {
      // Clean possible markdown code fences (```json ... ```)
      let cleaned = response.rawText.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();
      rawJson = JSON.parse(cleaned);
    } catch (err) {
      parseError = err instanceof Error ? err.message : "JSON syntax error";
    }

    if (!parseError && rawJson !== undefined) {
      const parsed = options.schema.safeParse(rawJson);
      if (parsed.success) {
        return parsed.data;
      }
      parseError = `Schema validation failed: ${parsed.error.message}`;
    }

    // Attempt 1-shot repair retry
    console.warn(`Structured output validation failed: ${parseError}. Attempting 1-shot repair retry...`);

    const repairSystem = `You are a JSON repair specialist. You must output strictly valid JSON conforming to the requested schema. Return ONLY valid JSON, with no explanation or markdown fences.`;
    const repairUser = `The previous response failed schema validation.
Error: ${parseError}

Original raw response:
${response.rawText}

Please correct the errors and output strictly valid JSON matching the schema.`;

    try {
      const repairResponse = await provider.complete(repairSystem, repairUser, true);
      let repairCleaned = repairResponse.rawText.trim();
      if (repairCleaned.startsWith("```json")) {
        repairCleaned = repairCleaned.slice(7);
      } else if (repairCleaned.startsWith("```")) {
        repairCleaned = repairCleaned.slice(3);
      }
      if (repairCleaned.endsWith("```")) {
        repairCleaned = repairCleaned.slice(0, -3);
      }
      repairCleaned = repairCleaned.trim();

      const repairedJson = JSON.parse(repairCleaned);
      const repairedParsed = options.schema.safeParse(repairedJson);
      if (repairedParsed.success) {
        return repairedParsed.data;
      }
      throw new Error(`Repaired output still invalid: ${repairedParsed.error.message}`);
    } catch (retryErr) {
      throw new AppError(
        "LLM_INVALID_OUTPUT",
        `LLM output failed validation and could not be repaired. Detail: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
        502
      );
    }
  }

  async *stream(options: StreamOptions): AsyncGenerator<string, void, unknown> {
    const env = getEnv();

    if (env.LLM_MODE === "replay") {
      const text = "This is a recorded replay response for automated testing.";
      const chunks = text.split(" ");
      for (const chunk of chunks) {
        yield chunk + " ";
      }
      return;
    }

    const availableProviders = this.providers.filter((p) => p.isAvailable());
    if (availableProviders.length === 0) {
      await this.logCall({
        sessionId: options.sessionId,
        purpose: options.purpose,
        provider: "none",
        model: "none",
        promptVersion: options.promptVersion,
        status: "error",
        errorCode: "NO_PROVIDERS_CONFIGURED",
      });
      throw new AppError("LLM_UNAVAILABLE", "No LLM providers are configured with active API keys.", 503);
    }

    let lastError: unknown = null;

    for (let i = 0; i < availableProviders.length; i++) {
      const provider = availableProviders[i];
      let emittedAnyToken = false;

      try {
        const streamGenerator = provider.stream(options.system, options.messages);
        const startTime = Date.now();

        for await (const chunk of streamGenerator) {
          emittedAnyToken = true;
          yield chunk;
        }

        const latencyMs = Date.now() - startTime;
        await this.logCall({
          sessionId: options.sessionId,
          purpose: options.purpose,
          provider: provider.name,
          model: provider.getModel(),
          promptVersion: options.promptVersion,
          latencyMs,
          status: i > 0 ? "failover" : "ok",
        });

        return; // stream finished successfully
      } catch (err) {
        lastError = err;
        const errMessage = err instanceof Error ? err.message : String(err);

        // Failover rule: fail over ONLY if no token has been emitted yet!
        if (emittedAnyToken) {
          console.error(`Stream error after token emission on ${provider.name}:`, err);
          throw new AppError("LLM_UNAVAILABLE", `Stream interrupted mid-generation: ${errMessage}`, 502);
        }

        await this.logCall({
          sessionId: options.sessionId,
          purpose: options.purpose,
          provider: provider.name,
          model: provider.getModel(),
          promptVersion: options.promptVersion,
          status: i < availableProviders.length - 1 ? "failover" : "error",
          errorCode: errMessage.slice(0, 100),
        });

        console.warn(`Provider ${provider.name} stream failed before first token: ${errMessage}. Attempting fallback...`);
      }
    }

    throw new AppError(
      "LLM_UNAVAILABLE",
      `All available LLM streaming providers failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      503
    );
  }
}

let routerInstance: LLMRouter | null = null;

export function getLLMRouter(): LLMRouter {
  if (!routerInstance) {
    routerInstance = new LLMRouter();
  }
  return routerInstance;
}
