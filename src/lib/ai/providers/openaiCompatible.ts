import type { LLMMessage, LLMProvider, ProviderResponse } from "../types";

/**
 * Shared client for any OpenAI-compatible `/chat/completions` endpoint
 * (OpenCode Go, Ollama, LM Studio, ...). Subclasses supply name, base URL, key and model from env.
 */
export abstract class OpenAICompatibleProvider implements LLMProvider {
  abstract name: string;
  abstract getModel(): string;
  abstract isAvailable(): boolean;
  protected abstract getBaseUrlRaw(): string;
  protected abstract getApiKey(): string;

  private getBaseUrl(): string {
    const url = this.getBaseUrlRaw();
    if (!url) throw new Error(`${this.name}: base URL is not configured`);
    return url.replace(/\/$/, "");
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = this.getApiKey();
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  async complete(system: string, user: string, jsonMode: boolean = false): Promise<ProviderResponse> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (system) {
      messages.push({ role: "system", content: system });
    }
    messages.push({ role: "user", content: user });

    const startTime = Date.now();
    const res = await fetch(`${this.getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: this.getModel(),
        messages,
        response_format: jsonMode ? { type: "json_object" } : undefined,
      }),
    });

    if (!res.ok) {
      throw new Error(`${this.name} failed with status ${res.status}: ${await res.text()}`);
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
    const formattedMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (system) {
      formattedMessages.push({ role: "system", content: system });
    }
    for (const msg of messages) {
      formattedMessages.push({ role: msg.role, content: msg.content });
    }

    const res = await fetch(`${this.getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: this.getModel(),
        messages: formattedMessages,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`${this.name} stream failed with status ${res.status}`);
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
            // Only `content` is the reply; reasoning models may also send `reasoning_content`, which is ignored
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
