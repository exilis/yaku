export const VERSION = "0.1.0";

// Schemas & types (the I/O contract)
export * from "./schemas/index.js";

// Engine
export { translate } from "./orchestrator/translate.js";
export type { TranslateDeps } from "./orchestrator/translate.js";

// Providers
export type { LLMProvider, EmbeddingProvider, TokenUsage } from "./providers/types.js";
export { MockProvider } from "./providers/mock.js";
export { OpenAIProvider } from "./providers/openai.js";
export { createProvider } from "./providers/factory.js";
export type { ProviderConfig } from "./providers/factory.js";

// Translation memory
export type { TranslationMemory, TMEntry, TMMatch } from "./memory/types.js";
export { SqliteTranslationMemory } from "./memory/sqlite.js";
export { PostgresTranslationMemory } from "./memory/postgres.js";
export { createTranslationMemory } from "./memory/factory.js";
export type { MemoryConfig } from "./memory/factory.js";
