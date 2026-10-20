import { z } from "zod";
import type { LLMPurpose } from "@/types";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions<T> {
  purpose: LLMPurpose;
  system: string;
  user: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  promptVersion: string;
  sessionId?: string | null;
}

export interface StreamOptions {
  purpose: LLMPurpose;
  system: string;
  messages: LLMMessage[];
  promptVersion: string;
  sessionId?: string | null;
}

export interface ProviderResponse {
  rawText: string;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface LLMProvider {
  name: string;
  getModel(): string;
  isAvailable(): boolean;
  // sessionId is the app session the call belongs to; providers that route by conversation (OpenCode Go) use it
  complete(system: string, user: string, jsonMode?: boolean, sessionId?: string | null): Promise<ProviderResponse>;
  stream(system: string, messages: LLMMessage[], sessionId?: string | null): AsyncGenerator<string, void, unknown>;
}
