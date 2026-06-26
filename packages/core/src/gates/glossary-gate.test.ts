import { describe, it, expect } from "vitest";
import { glossaryGate } from "./glossary-gate.js";
import type { AssembledGroup } from "./types.js";

function group(text: string, glossary: AssembledGroup["glossary"], tr: string): AssembledGroup {
  return { groupKey: "g", targetLang: "ja", sourceLang: "en", glossary, segments: [{ id: "s1", text }] };
}

describe("glossaryGate", () => {
  it("passes when do-not-translate term is kept verbatim", () => {
    const g = group("Welcome to Acme", [{ source: "Acme" }], "");
    const v = glossaryGate.check(g, { translations: { s1: "Acme へようこそ" } });
    expect(v).toHaveLength(0);
  });
  it("flags a do-not-translate term that was translated away", () => {
    const g = group("Welcome to Acme", [{ source: "Acme" }], "");
    const v = glossaryGate.check(g, { translations: { s1: "頂点へようこそ" } });
    expect(v).toHaveLength(1);
  });
  it("flags a forced mapping not applied", () => {
    const g = group("Sign in", [{ source: "Sign in", target: "ログイン", lang: "ja" }], "");
    const v = glossaryGate.check(g, { translations: { s1: "サインイン" } });
    expect(v).toHaveLength(1);
  });
  it("passes a forced mapping that was applied", () => {
    const g = group("Sign in", [{ source: "Sign in", target: "ログイン", lang: "ja" }], "");
    const v = glossaryGate.check(g, { translations: { s1: "ログイン" } });
    expect(v).toHaveLength(0);
  });
});
