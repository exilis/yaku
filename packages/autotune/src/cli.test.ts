import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "@yaku/core";
import type { TranslationMemory } from "@yaku/core";
import { runCandidate } from "./runner.js";
import { optimize, type LedgerIteration } from "./optimize.js";
import { writeProfile, readActiveProfile, setActive, appendLedger, nextVersion, type Profile } from "./profile.js";
import type { Candidate } from "./types.js";
import { loadGold } from "./gold.js";

const noopTm: TranslationMemory = {
  async lookupExact() { return null; },
  async lookupFuzzy() { return []; },
  async upsert() {},
  async invalidate() {},
};

let base: string;
let goldDir: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "autotune-cli-"));
  goldDir = join(base, "gold");
  mkdirSync(goldDir, { recursive: true });
  // 3 minimal gold records
  for (let i = 0; i < 3; i++) {
    writeFileSync(
      join(goldDir, `d${i}.json`),
      JSON.stringify({ sourceLang: "en", targetLangs: ["ja"], document: { id: `d${i}`, segments: [{ id: "t", text: `hello ${i}` }] } })
    );
  }
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("autotune CLI wiring (integration)", () => {
  it("loads gold, runs the loop, validates the winner, and persists a profile + ledger", async () => {
    const gold = loadGold(goldDir);
    expect(gold).toHaveLength(3);

    // A provider that always: translates "t" -> a ja string, engine reviewer passes,
    // judge scores high, and the proposer suggests a cheaper candidate once then dries up.
    // Build a fresh provider per runCandidate call so queues never run dry across docs.
    const makeProvider = () =>
      new MockProvider({
        translator: Array(10).fill({ translations: { t: "こんにちは" } }),
        reviewer: Array(10).fill(null).flatMap(() => [
          { passed: true, confidence: { t: 0.9 }, critique: "" },                                   // engine reviewer
          { score: 92, dims: { adequacy: 92, fluency: 92, terminology: 92, tone: 92 }, critique: "" }, // judge
        ]),
      });

    const proposals: Candidate[] = [{ config: { maxIterations: 2 }, rationale: "cheaper" }];
    let pi = 0;

    const ledgerEntries: LedgerIteration[] = [];
    const result = await optimize({
      baseline: { config: { models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } } },
      objective: { floor: 85, epsilon: 0.0001 },
      maxIter: 3, budgetUsd: 100, plateauK: 2,
      propose: async () => proposals[pi++] ?? null,
      runCandidate: async (c) =>
        runCandidate(
          { ...c, config: { models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } }, ...c.config } },
          gold,
          { provider: makeProvider(), tm: noopTm, judgeModel: "gpt-4o", translatorModelForPricing: "gpt-4o-mini" }
        ),
      onIteration: (e) => { ledgerEntries.push(e); appendLedger(base, { ...e, candidate: { config: e.candidate.config } }); },
    });

    // winner cleared the floor
    expect(result.bestMetrics.quality).toBeGreaterThanOrEqual(85);
    // ledger captured baseline + iterations, and the file was written
    expect(ledgerEntries[0]!.decision).toBe("baseline");
    expect(existsSync(join(base, "ledger.jsonl"))).toBe(true);

    // persist a profile and activate it, then read it back (mirrors CLI persistence)
    const version = nextVersion(base, "test");
    const profile: Profile = {
      name: "test", version, createdAt: new Date().toISOString(), parentVersion: null,
      config: result.best.config, promptTemplates: result.best.promptTemplates,
      provenance: { runId: "run-x", goldSet: goldDir, sample: 3, langs: ["ja"], judgeModel: "gpt-4o", objective: { floor: 85 } },
      metrics: { quality: result.bestMetrics.quality, estUsd: result.bestMetrics.estUsd, gatePassRate: result.bestMetrics.gatePassRate },
    };
    const path = writeProfile(base, profile);
    expect(existsSync(path)).toBe(true);
    setActive(base, "test", version);
    const active = readActiveProfile(base);
    expect(active?.name).toBe("test");
    expect(active?.version).toBe(version);
  });
});
