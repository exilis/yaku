import { describe, it, expect } from "vitest";
import { runTranslate } from "./translate-cmd.js";
import { MockProvider, SqliteTranslationMemory } from "@yaku/core";

describe("runTranslate", () => {
  it("reads a request object and returns a response object", async () => {
    const provider = new MockProvider({
      translator: [{ translations: { t: "やあ" } }],
      reviewer: [{ passed: true, confidence: { t: 0.9 }, critique: "" }],
    });
    const tm = new SqliteTranslationMemory(":memory:");
    const res = await runTranslate(
      { sourceLang: "en", targetLangs: ["ja"], document: { segments: [{ id: "t", text: "Hello there now" }] },
        config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } } },
      { provider, tm }
    );
    expect(res.results[0]!.segments[0]!.translatedText).toBe("やあ");
  });

  it("rejects an invalid request with a validation error", async () => {
    const provider = new MockProvider({});
    const tm = new SqliteTranslationMemory(":memory:");
    // Deliberately malformed request (empty targetLangs/segments) to exercise the
    // validation path; the cast bypasses the compile-time type to reach runtime validation.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(runTranslate({ sourceLang: "en", targetLangs: [], document: { segments: [] } } as any, { provider, tm })).rejects.toThrow();
  });
});
