import { describe, it, expect } from "vitest";
import { expansionGate } from "./expansion.js";
import type { AssembledGroup } from "./types.js";

function group(text: string, role?: string): AssembledGroup {
  return {
    groupKey: "g",
    targetLang: "en",
    sourceLang: "ja",
    glossary: [],
    segments: [
      { id: "s1", text, metadata: role === undefined ? {} : { role } },
    ],
  };
}

describe("expansionGate", () => {
  it("ignores segments without role=ui-label (prose is free to expand)", () => {
    // A long, sentence-y translation of a non-label segment must NOT be flagged.
    const v = expansionGate.check(group("保存して続行する"), {
      translations: {
        s1: "Save your changes and then continue to the next step.",
      },
    });
    expect(v).toHaveLength(0);
  });

  it("flags a ui-label whose translation became a full sentence", () => {
    const v = expansionGate.check(group("購入について", "ui-label"), {
      translations: { s1: "Here is some information regarding the purchase." },
    });
    expect(v).toHaveLength(1);
    expect(v[0].gate).toBe("expansion");
  });

  it("flags a ui-label that ballooned in word count", () => {
    const v = expansionGate.check(
      group("特定商取引法に基づく表示", "ui-label"),
      {
        translations: {
          s1: "Display based on the Specified Commercial Transactions Act",
        },
      },
    );
    expect(v).toHaveLength(1);
  });

  it("passes a terse ui-label translation", () => {
    expect(
      expansionGate.check(group("購入", "ui-label"), {
        translations: { s1: "Purchase" },
      }),
    ).toHaveLength(0);
    expect(
      expansionGate.check(group("次のページ", "ui-label"), {
        translations: { s1: "Next Page" },
      }),
    ).toHaveLength(0);
  });

  it("does not flag a CJK->CJK label (no script-expansion false positive)", () => {
    // ja -> zh of a label stays short; must pass.
    expect(
      expansionGate.check(group("購入について", "ui-label"), {
        translations: { s1: "关于购买" },
      }),
    ).toHaveLength(0);
  });

  it("allows a trailing question mark on a short label (e.g. a confirm prompt label)", () => {
    // "Delete?" is 1 word + '?' — still a label, must pass.
    expect(
      expansionGate.check(group("削除しますか", "ui-label"), {
        translations: { s1: "Delete?" },
      }),
    ).toHaveLength(0);
  });
});
