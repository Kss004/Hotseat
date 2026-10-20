import { getEnv } from "@/lib/env";
import { OpenAICompatibleProvider } from "./openaiCompatible";

export class LocalProvider extends OpenAICompatibleProvider {
  name = "local";

  getModel(): string {
    // Ollama and most OpenAI-compatible servers require a model name; it comes from the environment
    return getEnv().LOCAL_LLM_MODEL || "default";
  }

  isAvailable(): boolean {
    const url = getEnv().LOCAL_LLM_URL;
    return Boolean(url && url.trim().length > 0);
  }

  protected getBaseUrlRaw(): string {
    return getEnv().LOCAL_LLM_URL;
  }

  protected getApiKey(): string {
    return "";
  }
}
