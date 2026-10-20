import { randomUUID } from "crypto";
import { getEnv } from "@/lib/env";
import { OpenAICompatibleProvider } from "./openaiCompatible";

/** OpenCode Go: OpenAI-compatible chat/completions (e.g. OPENCODE_MODEL=deepseek-v4.1-flash). */
export class OpenCodeProvider extends OpenAICompatibleProvider {
  name = "opencode";

  getModel(): string {
    return getEnv().OPENCODE_MODEL;
  }

  isAvailable(): boolean {
    return Boolean(getEnv().OPENCODE_API_KEY && getEnv().OPENCODE_API_KEY.trim().length > 0);
  }

  protected getBaseUrlRaw(): string {
    return getEnv().OPENCODE_BASE_URL;
  }

  protected getApiKey(): string {
    return getEnv().OPENCODE_API_KEY;
  }

  /**
   * The Go gateway rejects requests without `x-opencode-session` (400 MissingSessionID). Per its docs, clients
   * send a stable ID per conversation (used for routing and prompt caching) and their own user agent.
   * The app session ID is that conversation ID; calls outside a session get a fresh one, as OpenCode does.
   */
  protected extraHeaders(sessionId?: string | null): Record<string, string> {
    return {
      "x-opencode-session": sessionId || `ses_${randomUUID()}`,
      "User-Agent": "hotseat/0.1",
    };
  }
}
