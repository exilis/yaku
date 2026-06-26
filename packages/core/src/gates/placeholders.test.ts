import { describe, it, expect } from "vitest";
import { placeholderGate } from "./placeholders.js";
import type { AssembledGroup } from "./types.js";

function group(segText: string): AssembledGroup {
  return {
    groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [],
    segments: [{ id: "s1", text: segText }],
  };
}

describe("placeholderGate", () => {
  it("passes when placeholders are preserved", () => {
    const v = placeholderGate.check(group("Hi {name}, you have %s items"), {
      translations: { s1: "こんにちは {name}、%s 件あります" },
    });
    expect(v).toHaveLength(0);
  });

  it("flags a missing {curly} placeholder", () => {
    const v = placeholderGate.check(group("Hi {name}"), { translations: { s1: "こんにちは" } });
    expect(v).toHaveLength(1);
    expect(v[0]!.segmentId).toBe("s1");
  });

  it("flags a missing {{double}} placeholder", () => {
    const v = placeholderGate.check(group("Total: {{count}}"), { translations: { s1: "合計:" } });
    expect(v).toHaveLength(1);
  });

  it("flags a missing %s placeholder", () => {
    const v = placeholderGate.check(group("%s left"), { translations: { s1: "残り" } });
    expect(v).toHaveLength(1);
  });
});
