import Groq from "groq-sdk";
import { getEnv } from "@/lib/env";
import type { LLMMessage, LLMProvider, ProviderResponse } from "../types";

export class GroqProvider implements LLMProvider {
  name = "groq";

  getModel(): string {
    return getEnv().GROQ_MODEL;
  }

  isAvailable(): boolean {
    return Boolean(getEnv().GROQ_API_KEY && getEnv().GROQ_API_KEY.trim().length > 0);
  }

  private getClient() {
    const key = getEnv().GROQ_API_KEY;
    if (!key) throw new Error("GROQ_API_KEY is not configured");
    return new Groq({ apiKey: key });
  }

  async complete(system: string, user: string, jsonMode: boolean = false): Promise<ProviderResponse> {
    const groq = this.getClient();
    const model = this.getModel();

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (system) {
      messages.push({ role: "system", content: system });
    }
    messages.push({ role: "user", content: user });

    const startTime = Date.now();
    const completion = await groq.chat.completions.create({
      model,
      messages,
      response_format: jsonMode ? { type: "json_object" } : undefined,
    });

    const latencyMs = Date.now() - startTime;
    const rawText = completion.choices[0]?.message?.content || "";

    return {
      rawText,
      provider: this.name,
      model,
      latencyMs,
    };
  }

  async *stream(system: string, messages: LLMMessage[]): AsyncGenerator<string, void, unknown> {
    const groq = this.getClient();
    const model = this.getModel();

    const formattedMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
    if (system) {
      formattedMessages.push({ role: "system", content: system });
    }
    for (const msg of messages) {
      formattedMessages.push({ role: msg.role, content: msg.content });
    }

    const responseStream = await groq.chat.completions.create({
      model,
      messages: formattedMessages,
      stream: true,
    });

    for await (const chunk of responseStream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }
}
