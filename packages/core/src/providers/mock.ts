import type { LLMProvider, CompleteArgs, LLMRole, TokenUsage } from "./types.js";

type Script = Partial<Record<LLMRole, unknown[]>>;

export class MockProvider implements LLMProvider {
  name = "mock";
  private queues: Map<LLMRole, unknown[]>;
  public calls: Array<{ role: LLMRole; prompt: string }> = [];

  constructor(script: Script) {
    this.queues = new Map();
    for (const role of Object.keys(script) as LLMRole[]) {
      this.queues.set(role, [...(script[role] ?? [])]);
    }
  }

  async complete<T>(args: CompleteArgs<T>): Promise<{ value: T; usage: TokenUsage }> {
    this.calls.push({ role: args.role, prompt: args.prompt });
    const q = this.queues.get(args.role);
    if (!q || q.length === 0) {
      throw new Error(`MockProvider: no scripted response for role "${args.role}"`);
    }
    const raw = q.shift();
    const value = args.schema.parse(raw); // validate against the demanded schema
    const usage: TokenUsage = { inputTokens: args.prompt.length, outputTokens: 1, usd: 0 };
    return { value, usage };
  }
}
