import { getEnv } from "@/lib/env";
import type { LLMMessage, LLMProvider, ProviderResponse } from "../types";

export class LocalProvider implements LLMProvider {
  name = "local";

  getModel(): string {
    return "local-model";
  }

  isAvailable(): boolean {
    const url = getEnv().LOCAL_LLM_URL;
    return Boolean(url && url.trim().length > 0);
  }

  private getBaseUrl(): string {
    const url = getEnv().LOCAL_LLM_URL;
    if (!url) throw new Error("LOCAL_LLM_URL is not configured");
    return url.replace(/\/$/, "");
  }

  async complete(system: string, user: string, jsonMode: boolean = false): Promise<ProviderResponse> {
    const baseUrl = this.getBaseUrl();
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (system) {
      messages.push({ role: "system", content: system });
    }
    messages.push({ role: "user", content: user });

    const startTime = Date.now();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.getModel(),
        messages,
        response_format: jsonMode ? { type: "json_object" } : undefined,
      }),
    });

    if (!res.ok) {
      throw new Error(`Local LLM failed with status ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    const latencyMs = Date.now() - startTime;
    const rawText = json.choices?.[0]?.message?.content || "";

    return {
      rawText,
      provider: this.name,
      model: this.getModel(),
      latencyMs,
    };
  }

  async *stream(system: string, messages: LLMMessage[]): AsyncGenerator<string, void, unknown> {
    const baseUrl = this.getBaseUrl();
    const formattedMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (system) {
      formattedMessages.push({ role: "system", content: system });
    }
    for (const msg of messages) {
      formattedMessages.push({ role: msg.role, content: msg.content });
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.getModel(),
        messages: formattedMessages,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Local LLM stream failed with status ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (trimmed.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // ignore malformed SSE line
          }
        }
      }
    }
  }
}
