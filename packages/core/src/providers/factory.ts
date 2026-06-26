import type { LLMProvider } from "./types.js";
import { OpenAIProvider } from "./openai.js";

export interface ProviderConfig {
  provider: string;
  apiKey?: string;
}

export function createProvider(cfg: ProviderConfig): LLMProvider {
  switch (cfg.provider) {
    case "openai":
      return new OpenAIProvider({ apiKey: cfg.apiKey });
    default:
      throw new Error(`unknown provider: ${cfg.provider}`);
  }
}
