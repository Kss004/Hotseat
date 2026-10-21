import { GoogleGenerativeAI } from "@google/generative-ai";
import { getEnv } from "@/lib/env";
import type { LLMMessage, LLMProvider, ProviderResponse } from "../types";

export class GeminiProvider implements LLMProvider {
  name = "gemini";

  getModel(): string {
    return getEnv().GEMINI_MODEL;
  }

  isAvailable(): boolean {
    return Boolean(getEnv().GEMINI_API_KEY && getEnv().GEMINI_API_KEY.trim().length > 0);
  }

  private getClient() {
    const key = getEnv().GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not configured");
    return new GoogleGenerativeAI(key);
  }

  async complete(
    system: string,
    user: string,
    jsonMode: boolean = false,
    _sessionId?: string | null,
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    const ai = this.getClient();
    const modelName = this.getModel();
    const model = ai.getGenerativeModel({
      model: modelName,
      systemInstruction: system || undefined,
      generationConfig: jsonMode ? { responseMimeType: "application/json" } : undefined,
    });

    const startTime = Date.now();
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
    }, { signal });

    const latencyMs = Date.now() - startTime;
    const rawText = result.response.text();

    return {
      rawText,
      provider: this.name,
      model: modelName,
      latencyMs,
    };
  }

  async *stream(
    system: string,
    messages: LLMMessage[],
    _sessionId?: string | null,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const ai = this.getClient();
    const modelName = this.getModel();
    const model = ai.getGenerativeModel({
      model: modelName,
      systemInstruction: system || undefined,
    });

    // Convert messages to Gemini format (role: user or model)
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const responseStream = await model.generateContentStream({
      contents,
    }, { signal });

    for await (const chunk of responseStream.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  }
}
