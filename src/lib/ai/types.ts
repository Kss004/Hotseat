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
  // Longest a single provider call (including the repair retry) may run before it is aborted and the router fails over
  timeoutMs?: number;
  // Total time for the whole failover chain; keep it below the route's maxDuration so the route can answer honestly
  budgetMs?: number;
}

export interface StreamOptions {
  purpose: LLMPurpose;
  system: string;
  messages: LLMMessage[];
  promptVersion: string;
  sessionId?: string | null;
  // A provider that sends no token within this window is aborted and the next one is tried
  firstTokenTimeoutMs?: number;
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
  // signal is aborted by the router when the call runs past its timeout
  complete(
    system: string,
    user: string,
    jsonMode?: boolean,
    sessionId?: string | null,
    signal?: AbortSignal
  ): Promise<ProviderResponse>;
  stream(
    system: string,
    messages: LLMMessage[],
    sessionId?: string | null,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown>;
}
