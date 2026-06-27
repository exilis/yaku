import { z } from "zod";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const ProfileSchema = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
  parentVersion: z.number().int().positive().nullable(),
  config: z.record(z.string(), z.unknown()),
  promptTemplates: z.any().optional(),
  provenance: z.object({
    runId: z.string(),
    goldSet: z.string(),
    sample: z.number(),
    langs: z.array(z.string()),
    judgeModel: z.string(),
    objective: z.object({ floor: z.number() }),
  }),
  metrics: z.object({
    quality: z.number(),
    estUsd: z.number(),
    gatePassRate: z.number(),
  }),
});

export type Profile = z.infer<typeof ProfileSchema>;

function profilesDir(baseDir: string): string {
  return join(baseDir, "profiles");
}

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

/** Highest existing version for a profile name + 1 (1 if none). */
export function nextVersion(baseDir: string, name: string): number {
  const dir = profilesDir(baseDir);
  if (!existsSync(dir)) return 1;
  const prefix = `${name}-v`;
  const versions = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .map((f) => Number(f.slice(prefix.length, -5)))
    .filter((n) => Number.isFinite(n));
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

/** Write an immutable versioned profile file. Refuses to overwrite. */
export function writeProfile(baseDir: string, profile: Profile): string {
  ProfileSchema.parse(profile);
  const dir = profilesDir(baseDir);
  ensureDir(dir);
  const path = join(dir, `${profile.name}-v${profile.version}.json`);
  if (existsSync(path)) throw new Error(`profile already exists (immutable): ${path}`);
  writeFileSync(path, JSON.stringify(profile, null, 2));
  return path;
}

/** Point active.json at a profile name+version. */
export function setActive(baseDir: string, name: string, version: number): void {
  const dir = profilesDir(baseDir);
  ensureDir(dir);
  writeFileSync(join(dir, "active.json"), JSON.stringify({ name, version }, null, 2));
}

/** Read the active profile (or null if none set / missing). */
export function readActiveProfile(baseDir: string): Profile | null {
  const activePath = join(profilesDir(baseDir), "active.json");
  if (!existsSync(activePath)) return null;
  const { name, version } = JSON.parse(readFileSync(activePath, "utf8")) as { name: string; version: number };
  const profilePath = join(profilesDir(baseDir), `${name}-v${version}.json`);
  if (!existsSync(profilePath)) return null;
  return ProfileSchema.parse(JSON.parse(readFileSync(profilePath, "utf8")));
}

/** Append one entry to the append-only ledger. */
export function appendLedger(baseDir: string, entry: Record<string, unknown>): void {
  ensureDir(baseDir);
  appendFileSync(join(baseDir, "ledger.jsonl"), JSON.stringify(entry) + "\n");
}
