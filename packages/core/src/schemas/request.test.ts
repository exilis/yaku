import { describe, it, expect } from "vitest";
import { TranslationRequestSchema } from "./request.js";

describe("TranslationRequestSchema", () => {
  it("accepts a single-language request", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "en",
      targetLangs: ["ja"],
      document: { segments: [{ id: "t", text: "Hi" }] },
    });
    expect(r.success).toBe(true);
  });

  it("accepts multi-language with context and glossary", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "auto",
      targetLangs: ["ja", "ko", "fr"],
      document: { id: "page1", segments: [{ id: "t", text: "Hi" }], context: "A landing page" },
      glossary: [{ source: "Acme" }],
      config: { maxIterations: 2 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty targetLangs", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "en",
      targetLangs: [],
      document: { segments: [{ id: "t", text: "Hi" }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate segment ids", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "en",
      targetLangs: ["ja"],
      document: { segments: [{ id: "t", text: "a" }, { id: "t", text: "b" }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "en",
      targetLang: "ja", // typo: should be targetLangs
      targetLangs: ["ja"],
      document: { segments: [{ id: "t", text: "Hi" }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing document", () => {
    const r = TranslationRequestSchema.safeParse({ sourceLang: "en", targetLangs: ["ja"] });
    expect(r.success).toBe(false);
  });

  it("rejects an empty sourceLang", () => {
    const r = TranslationRequestSchema.safeParse({
      sourceLang: "",
      targetLangs: ["ja"],
      document: { segments: [{ id: "t", text: "Hi" }] },
    });
    expect(r.success).toBe(false);
  });
});
