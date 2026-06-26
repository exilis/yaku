import { describe, it, expect } from "vitest";
import { resolveGlossary } from "./glossary.js";
import type { GlossaryEntry } from "../schemas/index.js";

const g: GlossaryEntry[] = [
  { source: "Acme" },                                    // global do-not-translate
  { source: "Sign in", target: "ログイン", lang: "ja" }, // ja-only forced mapping
  { source: "Sign in", target: "로그인", lang: "ko" },   // ko-only forced mapping
];

describe("resolveGlossary", () => {
  it("includes global entries and the matching-language entries", () => {
    const ja = resolveGlossary(g, "ja");
    expect(ja).toContainEqual({ source: "Acme" });
    expect(ja).toContainEqual({ source: "Sign in", target: "ログイン", lang: "ja" });
    expect(ja.find((e) => e.lang === "ko")).toBeUndefined();
  });
  it("returns only global when language has no specific entries", () => {
    const fr = resolveGlossary(g, "fr");
    expect(fr).toEqual([{ source: "Acme" }]);
  });
  it("handles undefined glossary", () => {
    expect(resolveGlossary(undefined, "ja")).toEqual([]);
  });
});
