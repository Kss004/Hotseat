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
}
