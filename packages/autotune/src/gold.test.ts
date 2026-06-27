import { describe, it, expect } from "vitest";
import { sampleRecords, MIN_GOLD } from "./gold.js";

function makeGold(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    sourceLang: "en",
    targetLangs: ["ja"],
    document: { id: `doc${i}`, segments: [{ id: "t", text: `text ${i}` }] },
  }));
}

describe("sampleRecords", () => {
  it("returns the requested number of records", () => {
    const sample = sampleRecords(makeGold(20), 5, 42);
    expect(sample).toHaveLength(5);
  });

  it("is deterministic for the same seed", () => {
    const a = sampleRecords(makeGold(20), 5, 42);
    const b = sampleRecords(makeGold(20), 5, 42);
    expect(a.map((r) => r.document.id)).toEqual(b.map((r) => r.document.id));
  });

  it("different seeds can produce different samples", () => {
    const a = sampleRecords(makeGold(50), 5, 1);
    const b = sampleRecords(makeGold(50), 5, 2);
    expect(a.map((r) => r.document.id)).not.toEqual(b.map((r) => r.document.id));
  });

  it("returns all records when n >= length", () => {
    const sample = sampleRecords(makeGold(3), 10, 42);
    expect(sample).toHaveLength(3);
  });

  it("exposes a minimum gold size constant", () => {
    expect(MIN_GOLD).toBeGreaterThanOrEqual(1);
  });
});
