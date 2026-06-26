import { describe, it, expect } from "vitest";
import { lengthGate } from "./length.js";
import type { AssembledGroup } from "./types.js";

function group(maxChars: number | undefined): AssembledGroup {
  return {
    groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [],
    segments: [{ id: "s1", text: "src", metadata: maxChars === undefined ? {} : { maxChars } }],
  };
}

describe("lengthGate", () => {
  it("passes within maxChars", () => {
    expect(lengthGate.check(group(10), { translations: { s1: "12345" } })).toHaveLength(0);
  });
  it("flags exceeding maxChars", () => {
    const v = lengthGate.check(group(3), { translations: { s1: "12345" } });
    expect(v).toHaveLength(1);
  });
  it("ignores segments without maxChars", () => {
    expect(lengthGate.check(group(undefined), { translations: { s1: "very long text here" } })).toHaveLength(0);
  });
  it("counts astral/emoji code points, not UTF-16 units", () => {
    // "👍👍👍" is 3 code points but 6 UTF-16 units; with maxChars 3 it must PASS,
    // and with maxChars 2 it must FAIL — proving code-point counting.
    expect(lengthGate.check(group(3), { translations: { s1: "👍👍👍" } })).toHaveLength(0);
    expect(lengthGate.check(group(2), { translations: { s1: "👍👍👍" } })).toHaveLength(1);
  });
});
