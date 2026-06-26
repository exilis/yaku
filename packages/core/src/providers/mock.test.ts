import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MockProvider } from "./mock.js";

const schema = z.object({ translations: z.record(z.string(), z.string()) });

describe("MockProvider", () => {
  it("returns scripted responses in order per role", async () => {
    const p = new MockProvider({
      translator: [{ translations: { s1: "draft1" } }, { translations: { s1: "draft2" } }],
    });
    const r1 = await p.complete({ role: "translator", system: "", prompt: "", schema, model: "m" });
    const r2 = await p.complete({ role: "translator", system: "", prompt: "", schema, model: "m" });
    expect(r1.value.translations.s1).toBe("draft1");
    expect(r2.value.translations.s1).toBe("draft2");
  });
  it("reports usage", async () => {
    const p = new MockProvider({ translator: [{ translations: { s1: "x" } }] });
    const r = await p.complete({ role: "translator", system: "", prompt: "", schema, model: "m" });
    expect(r.usage.inputTokens).toBeGreaterThanOrEqual(0);
  });
  it("throws when a role runs out of scripted responses", async () => {
    const p = new MockProvider({ translator: [] });
    await expect(
      p.complete({ role: "translator", system: "", prompt: "", schema, model: "m" })
    ).rejects.toThrow(/no scripted/i);
  });
});
