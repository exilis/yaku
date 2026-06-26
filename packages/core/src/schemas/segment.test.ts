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

  it("rejects an unknown key", () => {
    const r = SegmentSchema.safeParse({ id: "t", text: "x", bogus: 1 });
    expect(r.success).toBe(false);
  });

  it("rejects an empty id", () => {
    const r = SegmentSchema.safeParse({ id: "", text: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid maxChars (0, non-integer, negative)", () => {
    expect(
      SegmentSchema.safeParse({ id: "t", text: "x", metadata: { maxChars: 0 } }).success,
    ).toBe(false);
    expect(
      SegmentSchema.safeParse({ id: "t", text: "x", metadata: { maxChars: 1.5 } }).success,
    ).toBe(false);
    expect(
      SegmentSchema.safeParse({ id: "t", text: "x", metadata: { maxChars: -1 } }).success,
    ).toBe(false);
  });

  it("rejects a non-integer order", () => {
    const r = SegmentSchema.safeParse({ id: "t", text: "x", metadata: { order: 1.5 } });
    expect(r.success).toBe(false);
  });

  it("accepts an empty text (intentional allowance)", () => {
    const r = SegmentSchema.safeParse({ id: "t", text: "" });
    expect(r.success).toBe(true);
  });
});

describe("GlossaryEntrySchema", () => {
  it("accepts a do-not-translate term (no target)", () => {
    expect(GlossaryEntrySchema.safeParse({ source: "Acme" }).success).toBe(true);
  });
  it("accepts a forced mapping scoped to a language", () => {
    expect(GlossaryEntrySchema.safeParse({ source: "Sign in", target: "ログイン", lang: "ja" }).success).toBe(true);
  });

  it("rejects an unknown key", () => {
    expect(GlossaryEntrySchema.safeParse({ source: "x", bogus: 1 }).success).toBe(false);
  });

  it("rejects lang without target", () => {
    expect(GlossaryEntrySchema.safeParse({ source: "x", lang: "ja" }).success).toBe(false);
  });
});
