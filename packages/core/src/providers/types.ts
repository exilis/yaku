import type { ZodSchema } from "zod";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  usd?: number;
}

export type LLMRole = "translator" | "reviewer" | "backTranslator";

export interface CompleteArgs<T> {
  role: LLMRole;
  system: string;
  prompt: string;
  schema: ZodSchema<T>;
  model: string;
  temperature?: number;
}

export interface LLMProvider {
  name: string;
  complete<T>(args: CompleteArgs<T>): Promise<{ value: T; usage: TokenUsage }>;
}

export interface EmbeddingProvider {
  name: string;
  embed(texts: string[], model: string): Promise<{ vectors: number[][]; usage: TokenUsage }>;
}
