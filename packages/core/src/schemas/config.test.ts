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
});
