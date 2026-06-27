import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TranslationRequest } from "@yaku/core";

export type GoldRecord = TranslationRequest;

/** Minimum number of gold records required to run an optimization. */
export const MIN_GOLD = 3;

/** Load every *.json gold record from a directory. */
export function loadGold(dir: string): GoldRecord[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as GoldRecord);
}

/** Deterministic PRNG (mulberry32) so a seed always yields the same sample. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic seeded subset of `records` (seeded Fisher-Yates, take first n). */
export function sampleRecords(records: GoldRecord[], n: number, seed: number): GoldRecord[] {
  if (n >= records.length) return [...records];
  const rng = mulberry32(seed);
  const arr = [...records];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, n);
}
