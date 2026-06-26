import type { LLMProvider } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { MockProvider } from "./mock.js";

export interface ProviderConfig {
  provider: string;
  apiKey?: string;
}

export function createProvider(cfg: ProviderConfig): LLMProvider {
  switch (cfg.provider) {
    case "openai":
      return new OpenAIProvider({ apiKey: cfg.apiKey });
    case "mock":
      // Test/smoke provider — returns no scripted responses, so it throws on use.
      // Useful for validating wiring (schema validation, CLI plumbing) without an API key.
      return new MockProvider({});
    default:
      throw new Error(`unknown provider: ${cfg.provider}`);
  }
}
