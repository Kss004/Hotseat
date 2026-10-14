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
  complete(system: string, user: string, jsonMode?: boolean): Promise<ProviderResponse>;
  stream(system: string, messages: LLMMessage[]): AsyncGenerator<string, void, unknown>;
}
