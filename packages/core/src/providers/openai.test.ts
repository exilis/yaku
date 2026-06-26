import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type OpenAI from "openai";
import { OpenAIProvider } from "./openai.js";

// Minimal fake OpenAI client: we only stub `chat.completions.create`, so cast
// through `unknown` to the narrow `Pick<OpenAI, "chat">` the provider accepts.
type FakeClient = Pick<OpenAI, "chat">;

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
    const p = new OpenAIProvider({ client: fakeClient as unknown as FakeClient });
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
    const p = new OpenAIProvider({ client: fakeClient as unknown as FakeClient, parseRetries: 1 });
    await expect(
      p.complete({ role: "translator", system: "sys", prompt: "p", schema, model: "gpt-4o" })
    ).rejects.toThrow();
  });

  it("retries the network call via withRetry then succeeds", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ translations: { s1: "ok" } }) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    const fakeClient = { chat: { completions: { create } } };
    const p = new OpenAIProvider({ client: fakeClient as unknown as FakeClient });
    const r = await p.complete({ role: "translator", system: "s", prompt: "p", schema, model: "gpt-4o" });
    expect(r.value.translations.s1).toBe("ok");
    expect(create).toHaveBeenCalledTimes(2); // failed once, retried, succeeded
  });

  it("repairs on a first bad response then succeeds on retry (parse-retry success path)", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: "not json" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ translations: { s1: "fixed" } }) } }], usage: { prompt_tokens: 2, completion_tokens: 2 } });
    const fakeClient = { chat: { completions: { create } } };
    const p = new OpenAIProvider({ client: fakeClient as unknown as FakeClient, parseRetries: 1 });
    const r = await p.complete({ role: "translator", system: "s", prompt: "p", schema, model: "gpt-4o" });
    expect(r.value.translations.s1).toBe("fixed");
    expect(create).toHaveBeenCalledTimes(2);
    expect(r.usage.inputTokens).toBe(2); // usage from the successful (second) attempt
  });

  it("retries on valid JSON that fails the schema, then throws after exhaustion", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ wrong: 1 }) } }], // valid JSON, wrong shape
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const fakeClient = { chat: { completions: { create } } };
    const p = new OpenAIProvider({ client: fakeClient as unknown as FakeClient, parseRetries: 1 });
    await expect(p.complete({ role: "translator", system: "s", prompt: "p", schema, model: "gpt-4o" })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(2); // initial + 1 parse retry
  });
});
