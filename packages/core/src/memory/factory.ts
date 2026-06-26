import type { TranslationMemory } from "./types.js";
import { SqliteTranslationMemory } from "./sqlite.js";
import { PostgresTranslationMemory } from "./postgres.js";
import type { Pool } from "pg";
import type { EmbeddingProvider } from "../providers/types.js";

export type MemoryConfig =
  | { backend: "sqlite"; path?: string }
  | { backend: "postgres"; pool: Pool; embeddingProvider?: EmbeddingProvider | null; embeddingModel?: string };

export function createTranslationMemory(cfg: MemoryConfig): TranslationMemory {
  switch (cfg.backend) {
    case "sqlite":
      return new SqliteTranslationMemory(cfg.path ?? ":memory:");
    case "postgres":
      return new PostgresTranslationMemory({ pool: cfg.pool, embeddingProvider: cfg.embeddingProvider ?? null, embeddingModel: cfg.embeddingModel });
    default:
      throw new Error(`unknown memory backend: ${(cfg as { backend: string }).backend}`);
  }
}
