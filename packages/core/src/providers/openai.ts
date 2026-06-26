import OpenAI from "openai";
import type { LLMProvider, CompleteArgs, TokenUsage } from "./types.js";
import { withRetry } from "./retry.js";

export interface OpenAIProviderOptions {
  client?: Pick<OpenAI, "chat">;
  apiKey?: string;
  parseRetries?: number;
}

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client: Pick<OpenAI, "chat">;
  private parseRetries: number;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.client = opts.client ?? new OpenAI({ apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY });
    this.parseRetries = opts.parseRetries ?? 1;
  }

  async complete<T>(args: CompleteArgs<T>): Promise<{ value: T; usage: TokenUsage }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.parseRetries; attempt++) {
      const res = await withRetry(() =>
        this.client.chat.completions.create({
          model: args.model,
          temperature: args.temperature ?? 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: args.system },
            {
              role: "user",
              content:
                attempt === 0
                  ? args.prompt
                  : `${args.prompt}\n\nIMPORTANT: respond with ONLY valid JSON matching the requested schema.`,
            },
          ],
        })
      );
      const content = res.choices[0]?.message?.content ?? "";
      const usage: TokenUsage = {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      };
      try {
        const parsed = args.schema.parse(JSON.parse(content));
        return { value: parsed, usage };
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(`OpenAIProvider: failed to parse response into schema: ${String(lastErr)}`);
  }
}
