import { describe, it, expect } from "vitest";
import { SegmentSchema, GlossaryEntrySchema } from "./segment.js";

describe("SegmentSchema", () => {
  it("accepts a minimal segment", () => {
    const r = SegmentSchema.safeParse({ id: "title", text: "Hello" });
    expect(r.success).toBe(true);
  });

  it("accepts full metadata", () => {
    const r = SegmentSchema.safeParse({
      id: "body",
      text: "Welcome",
      metadata: { role: "body", group: "g1", order: 1, maxChars: 100, doNotTranslate: false, notes: "formal" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a segment without id", () => {
    const r = SegmentSchema.safeParse({ text: "Hello" });
    expect(r.success).toBe(false);
  });
});

describe("GlossaryEntrySchema", () => {
  it("accepts a do-not-translate term (no target)", () => {
    expect(GlossaryEntrySchema.safeParse({ source: "Acme" }).success).toBe(true);
  });
  it("accepts a forced mapping scoped to a language", () => {
    expect(GlossaryEntrySchema.safeParse({ source: "Sign in", target: "ログイン", lang: "ja" }).success).toBe(true);
  });
});
