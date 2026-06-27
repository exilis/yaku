import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProfile } from "./apply.js";
import { writeProfile, setActive, type Profile } from "./profile.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "apply-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function makeProfile(config: Record<string, unknown>, promptTemplates?: unknown): Profile {
  return {
    name: "p", version: 1, createdAt: "2026-06-27T00:00:00.000Z", parentVersion: null,
    config, promptTemplates,
    provenance: { runId: "r", goldSet: "g", sample: 3, langs: ["ja"], judgeModel: "gpt-4o", objective: { floor: 85 } },
    metrics: { quality: 90, estUsd: 0.1, gatePassRate: 1 },
  };
}

describe("applyProfile", () => {
  it("returns the request unchanged when no profile is active", () => {
    const req = { sourceLang: "en", targetLangs: ["ja"], document: { id: "d", segments: [] }, config: { maxIterations: 4 } };
    const out = applyProfile(req, dir);
    expect(out.config).toEqual({ maxIterations: 4 });
  });

  it("uses profile config as a baseline when request has none", () => {
    writeProfile(dir, makeProfile({ maxIterations: 2, reviewer: { enabled: true } }));
    setActive(dir, "p", 1);
    const req = { sourceLang: "en", targetLangs: ["ja"], document: { id: "d", segments: [] } };
    const out = applyProfile(req, dir) as { config: Record<string, unknown> };
    expect(out.config.maxIterations).toBe(2);
    expect(out.config.reviewer).toEqual({ enabled: true });
  });

  it("lets the request override profile values (request wins)", () => {
    writeProfile(dir, makeProfile({ maxIterations: 2, reviewer: { enabled: true } }));
    setActive(dir, "p", 1);
    const req = { sourceLang: "en", targetLangs: ["ja"], document: { id: "d", segments: [] }, config: { maxIterations: 5 } };
    const out = applyProfile(req, dir) as { config: Record<string, unknown> };
    expect(out.config.maxIterations).toBe(5);          // request wins
    expect(out.config.reviewer).toEqual({ enabled: true }); // profile sibling preserved
  });

  it("deep-merges nested config objects (profile fills siblings)", () => {
    writeProfile(dir, makeProfile({ models: { translator: { provider: "openai", model: "gpt-4o-mini" }, reviewer: { provider: "openai", model: "gpt-4o-mini" } } }));
    setActive(dir, "p", 1);
    const req = { sourceLang: "en", targetLangs: ["ja"], document: { id: "d", segments: [] }, config: { models: { translator: { provider: "openai", model: "gpt-4o" } } } };
    const out = applyProfile(req, dir) as { config: { models: Record<string, unknown> } };
    expect(out.config.models.translator).toEqual({ provider: "openai", model: "gpt-4o" }); // request wins on translator
    expect(out.config.models.reviewer).toEqual({ provider: "openai", model: "gpt-4o-mini" }); // profile reviewer preserved
  });

  it("applies profile promptTemplates onto config.promptTemplates", () => {
    const templates = { translator: { instruction: "X" } };
    writeProfile(dir, makeProfile({ maxIterations: 2 }, templates));
    setActive(dir, "p", 1);
    const req = { sourceLang: "en", targetLangs: ["ja"], document: { id: "d", segments: [] } };
    const out = applyProfile(req, dir) as { config: Record<string, unknown> };
    expect(out.config.promptTemplates).toEqual(templates);
  });
});
