import { describe, it, expect } from "vitest";
import { TranslationConfigSchema, DEFAULT_CONFIG, resolveConfig } from "./config.js";

describe("config", () => {
  it("parses an empty config and applies defaults", () => {
    const c = TranslationConfigSchema.parse({});
    expect(c.maxIterations).toBe(3);
    expect(c.reviewer.enabled).toBe(true);
    expect(c.backTranslation.enabled).toBe(false);
    expect(c.tm.enabled).toBe(true);
    expect(c.tm.fuzzy).toBe("both");
    expect(c.concurrency).toBe(8);
    expect(c.trace).toBe("none");
  });

  it("DEFAULT_CONFIG is a valid parsed config", () => {
    expect(DEFAULT_CONFIG.maxIterations).toBe(3);
  });

  it("resolveConfig merges request over defaults", () => {
    const c = resolveConfig({ maxIterations: 5 });
    expect(c.maxIterations).toBe(5);
    expect(c.concurrency).toBe(8);
  });

  it("resolveConfig applies a per-language override", () => {
    const c = resolveConfig({ perLanguage: { ja: { maxIterations: 2 } } });
    const ja = resolveConfig(c, "ja");
    expect(ja.maxIterations).toBe(2);
  });

  it("nested per-language override preserves sibling fields", () => {
    const c = resolveConfig({
      tm: { enabled: false },
      perLanguage: { ja: { tm: { fuzzy: "off" } } },
    });
    const ja = resolveConfig(c, "ja");
    expect(ja.tm.enabled).toBe(false); // preserved from global
    expect(ja.tm.fuzzy).toBe("off"); // overridden
    expect(ja.tm.fuzzyThreshold).toBe(0.85); // default preserved
  });

  it("request-level nested partial preserves defaults", () => {
    const c = resolveConfig({ tm: { fuzzy: "off" } });
    expect(c.tm.fuzzy).toBe("off");
    expect(c.tm.enabled).toBe(true); // default preserved, not clobbered
  });

  it(".strict() rejects unknown top-level key", () => {
    expect(() => TranslationConfigSchema.parse({ bogus: 1 })).toThrow();
  });

  it("maxIterations: 0 is rejected", () => {
    expect(() => TranslationConfigSchema.parse({ maxIterations: 0 })).toThrow();
  });
});
