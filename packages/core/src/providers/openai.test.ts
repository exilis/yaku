import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { OpenAIProvider } from "./openai.js";

const schema = z.object({ translations: z.record(z.string(), z.string()) });

describe("OpenAIProvider", () => {
  it("parses a JSON content response into the schema", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: JSON.stringify({ translations: { s1: "やあ" } }) } }],
            usage: { prompt_tokens: 12, completion_tokens: 4 },
          }),
        },
      },
    };
    const p = new OpenAIProvider({ client: fakeClient as any });
    const r = await p.complete({ role: "translator", system: "sys", prompt: "p", schema, model: "gpt-4o" });
    expect(r.value.translations.s1).toBe("やあ");
    expect(r.usage.inputTokens).toBe(12);
    expect(r.usage.outputTokens).toBe(4);
  });

  it("retries then throws on repeated invalid JSON", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "not json" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        },
      },
    };
    const p = new OpenAIProvider({ client: fakeClient as any, parseRetries: 1 });
    await expect(
      p.complete({ role: "translator", system: "sys", prompt: "p", schema, model: "gpt-4o" })
    ).rejects.toThrow();
  });
});
