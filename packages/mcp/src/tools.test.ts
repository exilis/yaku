import { describe, it, expect } from "vitest";
import { makeTranslateHandler, makeInvalidateHandler, createMcpServer } from "./index.js";
import { MockProvider, SqliteTranslationMemory } from "@yaku/core";

describe("mcp translate tool handler", () => {
  it("translates a request and returns content with the response JSON", async () => {
    const deps = {
      provider: new MockProvider({
        translator: [{ translations: { t: "やあ" } }],
        reviewer: [{ passed: true, confidence: { t: 0.9 }, critique: "" }],
      }),
      tm: new SqliteTranslationMemory(":memory:"),
    };
    const handler = makeTranslateHandler(deps);
    const out = await handler({
      sourceLang: "en", targetLangs: ["ja"],
      document: { segments: [{ id: "t", text: "Hello there now" }] },
      config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } },
    });
    const parsed = JSON.parse(out.content[0]!.text);
    expect(parsed.results[0].segments[0].translatedText).toBe("やあ");
  });

  it("rejects invalid input", async () => {
    const deps = { provider: new MockProvider({}), tm: new SqliteTranslationMemory(":memory:") };
    const handler = makeTranslateHandler(deps);
    await expect(handler({ sourceLang: "en", targetLangs: [], document: { segments: [] } } as any)).rejects.toThrow();
  });

  it("tm_invalidate handler removes matching entries and returns ok", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    const handler = makeInvalidateHandler({ provider: new MockProvider({}), tm });
    const out = await handler({ targetLang: "ja" });
    expect(out.content[0]!.text).toBe("ok");
    expect(await tm.lookupExact("Hi", "en", "ja")).toBeNull();
  });

  it("createMcpServer instantiates without throwing", () => {
    const server = createMcpServer({ provider: new MockProvider({}), tm: new SqliteTranslationMemory(":memory:") });
    expect(server).toBeDefined();
  });
});
