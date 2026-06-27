import { describe, it, expect } from "vitest";
import { buildTranslatorPrompt } from "./prompts.js";
import { ReviewSchema } from "./reviewer.js";
import type { AssembledGroup } from "../gates/types.js";

const group: AssembledGroup = {
  groupKey: "hero", targetLang: "ja", sourceLang: "en",
  glossary: [{ source: "Acme" }, { source: "Sign in", target: "ログイン", lang: "ja" }],
  context: "A landing page",
  segments: [{ id: "title", text: "Welcome to Acme", metadata: { role: "title" } }],
};

describe("buildTranslatorPrompt", () => {
  it("includes target language, segments, glossary, and context", () => {
    const p = buildTranslatorPrompt(group, {});
    expect(p).toContain("ja");
    expect(p).toContain("Welcome to Acme");
    expect(p).toContain("Acme");
    expect(p).toContain("ログイン");
    expect(p).toContain("A landing page");
    expect(p).toContain("title");
  });
  it("includes prior critique on revision", () => {
    const p = buildTranslatorPrompt(group, { critique: "too literal", gateViolations: ["missing placeholder"] });
    expect(p).toContain("too literal");
    expect(p).toContain("missing placeholder");
  });
  it("includes fuzzy TM suggestions when provided", () => {
    const p = buildTranslatorPrompt(group, { suggestions: { title: "Acme へようこそ" } });
    expect(p).toContain("Acme へようこそ");
  });
});

describe("ReviewSchema", () => {
  it("validates a reviewer verdict", () => {
    const r = ReviewSchema.safeParse({ passed: true, confidence: { title: 0.9 }, critique: "" });
    expect(r.success).toBe(true);
  });
});

import { buildReviewerPrompt, buildBackTranslationPrompt, DEFAULT_TEMPLATES } from "./prompts.js";

describe("prompt templates", () => {
  it("DEFAULT_TEMPLATES reproduces the original translator wording", () => {
    const p = buildTranslatorPrompt(group, {});
    const pDefault = buildTranslatorPrompt(group, {}, DEFAULT_TEMPLATES);
    expect(p).toBe(pDefault);
  });

  it("applies a translator instruction override with placeholders filled", () => {
    const templates = {
      ...DEFAULT_TEMPLATES,
      translator: { ...DEFAULT_TEMPLATES.translator, instruction: "Render {sourceLang} into {targetLang} now." },
    };
    const p = buildTranslatorPrompt(group, {}, templates);
    expect(p).toContain("Render en into ja now.");
    expect(p).toContain("Welcome to Acme");
  });

  it("applies a reviewer instruction override", () => {
    const draft = { title: "Acme へようこそ" };
    const templates = {
      ...DEFAULT_TEMPLATES,
      reviewer: { ...DEFAULT_TEMPLATES.reviewer, instruction: "Audit {sourceLang}->{targetLang}." },
    };
    const p = buildReviewerPrompt(group, draft, templates);
    expect(p).toContain("Audit en->ja.");
    expect(p).toContain("Acme へようこそ");
  });

  it("back-translation default still mentions both directions", () => {
    const draft = { title: "Acme へようこそ" };
    const p = buildBackTranslationPrompt(group, draft);
    expect(p).toContain("ja");
    expect(p).toContain("en");
  });
});
