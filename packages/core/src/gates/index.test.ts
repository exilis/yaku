import { describe, it, expect } from "vitest";
import { runGates, GATES } from "./index.js";
import type { AssembledGroup } from "./types.js";

describe("runGates", () => {
  it("includes all five built-in gates", () => {
    expect(GATES.map((g) => g.name)).toEqual(["placeholders", "markup", "glossary", "length", "leftover"]);
  });
  it("aggregates violations across gates", () => {
    const g: AssembledGroup = {
      groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [],
      segments: [{ id: "s1", text: "Hi {name}", metadata: { maxChars: 2 } }],
    };
    const v = runGates(g, { translations: { s1: "こんにちは" } }); // missing placeholder + too long
    expect(v.length).toBeGreaterThanOrEqual(2);
  });
});
