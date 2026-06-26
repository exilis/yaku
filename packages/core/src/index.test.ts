import { describe, it, expect } from "vitest";
import { createProvider, createTranslationMemory, translate } from "./index.js";

describe("core public API", () => {
  it("exports translate", () => {
    expect(typeof translate).toBe("function");
  });
  it("createProvider builds an openai provider", () => {
    const p = createProvider({ provider: "openai", apiKey: "test" });
    expect(p.name).toBe("openai");
  });
  it("createTranslationMemory builds a sqlite memory", () => {
    const m = createTranslationMemory({ backend: "sqlite", path: ":memory:" });
    expect(m).toBeDefined();
  });
  it("createTranslationMemory throws on unknown backend", () => {
    // @ts-expect-error invalid backend
    expect(() => createTranslationMemory({ backend: "nope" })).toThrow();
  });
});
