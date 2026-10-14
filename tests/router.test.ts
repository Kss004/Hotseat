import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { LLMRouter } from "@/lib/ai/router";
import { AppError } from "@/lib/errors";
import type { LLMMessage, LLMProvider, ProviderResponse } from "@/lib/ai/types";

// Schema for test validation
const testSchema = z.object({
  score: z.number(),
  comment: z.string(),
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  }),
}));

describe("LLMRouter unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. 429 Failover: switches from primary to fallback when primary throws 429", async () => {
    const primaryProvider: LLMProvider = {
      name: "gemini",
      getModel: () => "gemini-test",
      isAvailable: () => true,
      complete: vi.fn().mockRejectedValue(new Error("429 Resource has been exhausted (quota)")),
      stream: vi.fn(),
    };

    const fallbackProvider: LLMProvider = {
      name: "groq",
      getModel: () => "llama-test",
      isAvailable: () => true,
      complete: vi.fn().mockResolvedValue({
        rawText: JSON.stringify({ score: 95, comment: "Fallback provider succeeded" }),
        provider: "groq",
        model: "llama-test",
        latencyMs: 120,
      }),
      stream: vi.fn(),
    };

    const router = new LLMRouter([primaryProvider, fallbackProvider]);
    const result = await router.complete({
      purpose: "persona",
      system: "test system",
      user: "test user",
      schema: testSchema,
      promptVersion: "v1.0",
    });

    expect(primaryProvider.complete).toHaveBeenCalledTimes(1);
    expect(fallbackProvider.complete).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("groq");
    expect(result.data).toEqual({ score: 95, comment: "Fallback provider succeeded" });
  });

  it("2. All providers fail: throws LLM_UNAVAILABLE error", async () => {
    const primaryProvider: LLMProvider = {
      name: "gemini",
      getModel: () => "gemini-test",
      isAvailable: () => true,
      complete: vi.fn().mockRejectedValue(new Error("503 Service Unavailable")),
      stream: vi.fn(),
    };

    const fallbackProvider: LLMProvider = {
      name: "groq",
      getModel: () => "llama-test",
      isAvailable: () => true,
      complete: vi.fn().mockRejectedValue(new Error("500 Internal Server Error")),
      stream: vi.fn(),
    };

    const router = new LLMRouter([primaryProvider, fallbackProvider]);

    await expect(
      router.complete({
        purpose: "persona",
        system: "test system",
        user: "test user",
        schema: testSchema,
        promptVersion: "v1.0",
      })
    ).rejects.toThrowError(AppError);

    try {
      await router.complete({
        purpose: "persona",
        system: "test system",
        user: "test user",
        schema: testSchema,
        promptVersion: "v1.0",
      });
    } catch (err) {
      expect((err as AppError).code).toBe("LLM_UNAVAILABLE");
    }
  });

  it("3. Repair retry success: repairs malformed output on retry", async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: "gemini",
      getModel: () => "gemini-test",
      isAvailable: () => true,
      complete: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First attempt: returns invalid schema (missing comment)
          return {
            rawText: JSON.stringify({ score: 80 }),
            provider: "gemini",
            model: "gemini-test",
            latencyMs: 150,
          };
        }
        // Second attempt (repair): returns fixed valid JSON
        return {
          rawText: JSON.stringify({ score: 80, comment: "Repaired comment" }),
          provider: "gemini",
          model: "gemini-test",
          latencyMs: 100,
        };
      }),
      stream: vi.fn(),
    };

    const router = new LLMRouter([provider]);
    const result = await router.complete({
      purpose: "persona",
      system: "test system",
      user: "test user",
      schema: testSchema,
      promptVersion: "v1.0",
    });

    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ score: 80, comment: "Repaired comment" });
  });

  it("4. Invalid JSON twice: throws LLM_INVALID_OUTPUT when repair fails", async () => {
    const provider: LLMProvider = {
      name: "gemini",
      getModel: () => "gemini-test",
      isAvailable: () => true,
      complete: vi.fn().mockResolvedValue({
        rawText: "This is completely not JSON at all {{{",
        provider: "gemini",
        model: "gemini-test",
        latencyMs: 100,
      }),
      stream: vi.fn(),
    };

    const router = new LLMRouter([provider]);

    try {
      await router.complete({
        purpose: "persona",
        system: "test system",
        user: "test user",
        schema: testSchema,
        promptVersion: "v1.0",
      });
      expect.fail("Should have thrown LLM_INVALID_OUTPUT");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("LLM_INVALID_OUTPUT");
      // Checked repair attempt was made: 1 initial + 1 repair
      expect(provider.complete).toHaveBeenCalledTimes(2);
    }
  });

  it("5. Streaming failover occurs before first token", async () => {
    const failingProvider: LLMProvider = {
      name: "gemini",
      getModel: () => "gemini-test",
      isAvailable: () => true,
      complete: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        throw new Error("Stream connection failed immediately");
      }),
    };

    const workingProvider: LLMProvider = {
      name: "groq",
      getModel: () => "llama-test",
      isAvailable: () => true,
      complete: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        yield "Hello ";
        yield "from ";
        yield "Groq!";
      }),
    };

    const router = new LLMRouter([failingProvider, workingProvider]);
    const tokens: string[] = [];

    for await (const token of router.stream({
      purpose: "chat",
      system: "test system",
      messages: [{ role: "user", content: "hi" }],
      promptVersion: "v1.0",
    })) {
      tokens.push(token);
    }

    expect(tokens.join("")).toBe("Hello from Groq!");
    expect(failingProvider.stream).toHaveBeenCalledTimes(1);
    expect(workingProvider.stream).toHaveBeenCalledTimes(1);
  });

  it("6. Never switch provider mid-stream if a token was already yielded", async () => {
    const midStreamFailingProvider: LLMProvider = {
      name: "gemini",
      getModel: () => "gemini-test",
      isAvailable: () => true,
      complete: vi.fn(),
      stream: vi.fn().mockImplementation(async function* () {
        yield "First token received...";
        throw new Error("Mid-stream connection dropped");
      }),
    };

    const fallbackProvider: LLMProvider = {
      name: "groq",
      getModel: () => "llama-test",
      isAvailable: () => true,
      complete: vi.fn(),
      stream: vi.fn(),
    };

    const router = new LLMRouter([midStreamFailingProvider, fallbackProvider]);
    const tokens: string[] = [];

    try {
      for await (const token of router.stream({
        purpose: "chat",
        system: "test system",
        messages: [{ role: "user", content: "hi" }],
        promptVersion: "v1.0",
      })) {
        tokens.push(token);
      }
      expect.fail("Should have thrown stream interruption error");
    } catch (err) {
      expect((err as AppError).code).toBe("LLM_UNAVAILABLE");
      // Verified fallback was NOT invoked because mid-stream switch is prohibited
      expect(fallbackProvider.stream).not.toHaveBeenCalled();
    }
  });
});
