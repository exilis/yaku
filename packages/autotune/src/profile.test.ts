import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeProfile, readActiveProfile, setActive, appendLedger, nextVersion } from "./profile.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "autotune-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const sampleProfile = {
  name: "activities",
  version: 1,
  createdAt: "2026-06-27T00:00:00.000Z",
  parentVersion: null,
  config: { maxIterations: 3 },
  promptTemplates: undefined,
  provenance: { runId: "run-1", goldSet: "activities", sample: 6, langs: ["ja"], judgeModel: "gpt-4o", objective: { floor: 85 } },
  metrics: { quality: 89, estUsd: 0.4, gatePassRate: 1 },
};

describe("profile store", () => {
  it("writes a versioned profile file", () => {
    writeProfile(dir, sampleProfile);
    expect(existsSync(join(dir, "profiles", "activities-v1.json"))).toBe(true);
  });

  it("nextVersion increments based on existing files", () => {
    writeProfile(dir, sampleProfile);
    expect(nextVersion(dir, "activities")).toBe(2);
    expect(nextVersion(dir, "missing")).toBe(1);
  });

  it("setActive + readActiveProfile round-trips", () => {
    writeProfile(dir, sampleProfile);
    setActive(dir, "activities", 1);
    const active = readActiveProfile(dir);
    expect(active?.name).toBe("activities");
    expect(active?.version).toBe(1);
  });

  it("readActiveProfile returns null when none set", () => {
    expect(readActiveProfile(dir)).toBeNull();
  });

  it("appendLedger appends one JSON line per call", () => {
    appendLedger(dir, { runId: "r", iter: 0, decision: "baseline" });
    appendLedger(dir, { runId: "r", iter: 1, decision: "accept" });
    const lines = readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).decision).toBe("accept");
  });
});
