import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTranslateHandler, makeInvalidateHandler, makeLookupHandler, createMcpServer } from "./index.js";
import { MockProvider, SqliteTranslationMemory } from "@yaku/core";
import { writeProfile, setActive, type Profile } from "@yaku/autotune";

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
    // Deliberately malformed input (empty targetLangs/segments) to exercise the
    // handler's validation path; the cast reaches runtime validation past the types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  it("tm_lookup handler returns a stored entry", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    await tm.upsert({ sourceText: "Hi", sourceLang: "en", targetLang: "ja", translatedText: "やあ", sourceHash: "h" });
    const handler = makeLookupHandler({ provider: new MockProvider({}), tm });
    const out = await handler({ sourceText: "Hi", sourceLang: "en", targetLang: "ja" });
    const entry = JSON.parse(out.content[0]!.text);
    expect(entry.translatedText).toBe("やあ");
  });
  it("tm_lookup handler returns null for a miss", async () => {
    const tm = new SqliteTranslationMemory(":memory:");
    const handler = makeLookupHandler({ provider: new MockProvider({}), tm });
    const out = await handler({ sourceText: "Nope", sourceLang: "en", targetLang: "ja" });
    expect(JSON.parse(out.content[0]!.text)).toBeNull();
  });

  it("createMcpServer instantiates without throwing", () => {
    const server = createMcpServer({ provider: new MockProvider({}), tm: new SqliteTranslationMemory(":memory:") });
    expect(server).toBeDefined();
  });

  describe("with a profileBase applied", () => {
    let dir: string;
    afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

    function makeProfile(config: Record<string, unknown>): Profile {
      return {
        name: "p", version: 1, createdAt: "2026-06-27T00:00:00.000Z", parentVersion: null,
        config,
        provenance: { runId: "r", goldSet: "g", sample: 3, langs: ["ja"], judgeModel: "gpt-4o", objective: { floor: 85 } },
        metrics: { quality: 90, estUsd: 0.1, gatePassRate: 1 },
      };
    }

    it("applies the active profile so a config-less request translates", async () => {
      dir = mkdtempSync(join(tmpdir(), "mcp-profile-"));
      writeProfile(dir, makeProfile({
        maxIterations: 2,
        reviewer: { enabled: false },
        tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 },
        models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } },
      }));
      setActive(dir, "p", 1);

      const deps = {
        provider: new MockProvider({
          translator: [{ translations: { t: "やあ" } }],
          reviewer: [{ passed: true, confidence: { t: 0.9 }, critique: "" }],
        }),
        tm: new SqliteTranslationMemory(":memory:"),
      };
      const handler = makeTranslateHandler(deps, dir);
      const out = await handler({
        sourceLang: "en", targetLangs: ["ja"],
        document: { segments: [{ id: "t", text: "Hello there now" }] },
      });
      const parsed = JSON.parse(out.content[0]!.text);
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results[0].segments[0].translatedText).toBe("やあ");
    });
  });
});
