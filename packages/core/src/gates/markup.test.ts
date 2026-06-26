import { describe, it, expect } from "vitest";
import { markupGate } from "./markup.js";
import type { AssembledGroup } from "./types.js";

function group(text: string): AssembledGroup {
  return { groupKey: "g", targetLang: "ja", sourceLang: "en", glossary: [], segments: [{ id: "s1", text }] };
}

describe("markupGate", () => {
  it("passes when tags are preserved", () => {
    const v = markupGate.check(group("Click <a href='x'>here</a>"), {
      translations: { s1: "<a href='x'>ここ</a>をクリック" },
    });
    expect(v).toHaveLength(0);
  });
  it("flags a dropped tag", () => {
    const v = markupGate.check(group("<b>Bold</b>"), { translations: { s1: "太字" } });
    expect(v).toHaveLength(1);
  });
  it("ignores segments with no markup", () => {
    const v = markupGate.check(group("plain"), { translations: { s1: "プレーン" } });
    expect(v).toHaveLength(0);
  });
});
