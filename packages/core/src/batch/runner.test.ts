import { describe, it, expect } from "vitest";
import { translateBatch } from "./runner.js";
import { MockProvider } from "../providers/mock.js";
import { SqliteTranslationMemory } from "../memory/sqlite.js";
import type { TranslationRequest } from "../schemas/index.js";

function makeReq(id: string, text: string): TranslationRequest {
  return {
    sourceLang: "en", targetLangs: ["ja"],
    document: { id, segments: [{ id: "t", text }] },
    config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } } satisfies TranslationRequest["config"],
  };
}

describe("translateBatch", () => {
  it("translates multiple documents and isolates failures", async () => {
    // doc A succeeds; doc B has no scripted responses → fails but doesn't kill the batch.
    const provider = new MockProvider({
      translator: [{ translations: { t: "やあ" } }],
      reviewer: [{ passed: true, confidence: { t: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const results = await translateBatch([makeReq("A", "Hello there now"), makeReq("B", "Another line here")], { provider, tm }, 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.status).toBe("ok");
    expect(results[1]!.status).toBe("partial"); // B failed gracefully
  });
});
