import { describe, it, expect } from "vitest";
import { leftoverGate } from "./leftover.js";
import type { AssembledGroup } from "./types.js";

function group(src: string, tr: string): AssembledGroup {
  return { groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [], segments: [{ id: "s1", text: src }] };
}

describe("leftoverGate", () => {
  it("passes when target differs from source", () => {
    expect(leftoverGate.check(group("Hello world", ""), { translations: { s1: "こんにちは世界" } })).toHaveLength(0);
  });
  it("flags target identical to a multi-word source", () => {
    const v = leftoverGate.check(group("Hello world friend", ""), { translations: { s1: "Hello world friend" } });
    expect(v).toHaveLength(1);
  });
  it("ignores short/identifier-like sources", () => {
    expect(leftoverGate.check(group("OK", ""), { translations: { s1: "OK" } })).toHaveLength(0);
  });
});
