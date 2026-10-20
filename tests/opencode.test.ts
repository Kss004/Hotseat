import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenCodeProvider } from "@/lib/ai/providers/opencode";
import { getEnv, resetEnvCache } from "@/lib/env";

function sseBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      // Split mid-line to exercise the buffered parser
      const text = lines.join("\n") + "\n";
      const mid = Math.floor(text.length / 2);
      controller.enqueue(encoder.encode(text.slice(0, mid)));
      controller.enqueue(encoder.encode(text.slice(mid)));
      controller.close();
    },
  });
}

describe("OpenCode Go provider", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.OPENCODE_API_KEY = "test-key";
    process.env.OPENCODE_MODEL = "deepseek-v4.1-flash";
    delete process.env.OPENCODE_BASE_URL;
    resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
    vi.unstubAllGlobals();
  });

  it("1. complete: posts to the Go chat/completions endpoint with bearer auth, env model and JSON mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await new OpenCodeProvider().complete("sys", "hi", true, "sess_abc");

    expect(res).toMatchObject({ rawText: '{"ok":true}', provider: "opencode", model: "deepseek-v4.1-flash" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://opencode.ai/inference/go/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    // The Go gateway returns 400 MissingSessionID without this; the app session is the conversation ID
    expect(init.headers["x-opencode-session"]).toBe("sess_abc");
    expect(init.headers["User-Agent"]).toBe("hotseat/0.1");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek-v4.1-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
  });

  it("2. complete: non-2xx throws so the router can fail over", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));
    await expect(new OpenCodeProvider().complete("", "hi")).rejects.toThrow(/429/);
  });

  it("3. stream: yields only content deltas, skipping reasoning_content and [DONE]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          sseBody([
            'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}',
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"choices":[{"delta":{"content":" there"}}]}',
            "data: [DONE]",
          ]),
          { status: 200 }
        )
      )
    );

    let out = "";
    for await (const chunk of new OpenCodeProvider().stream("sys", [{ role: "user", content: "hi" }])) {
      out += chunk;
    }
    expect(out).toBe("Hello there");
  });

  it("4. availability and config: no key means unavailable; key without model is a config error", () => {
    process.env.OPENCODE_API_KEY = "";
    resetEnvCache();
    expect(new OpenCodeProvider().isAvailable()).toBe(false);

    process.env.OPENCODE_API_KEY = "test-key";
    process.env.OPENCODE_MODEL = "";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/OPENCODE_MODEL/);
  });
});
