#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OpenAIProvider, SqliteTranslationMemory } from "@yaku/core";
import { loadGold, sampleRecords, MIN_GOLD, type GoldRecord } from "./gold.js";
import { runCandidate } from "./runner.js";
import { propose } from "./proposer.js";
import { optimize, type LedgerIteration } from "./optimize.js";
import { readActiveProfile, writeProfile, setActive, appendLedger, nextVersion, type Profile } from "./profile.js";
import type { Candidate } from "./types.js";

const program = new Command();
program.name("yaku-autotune").description("Autonomous translation pipeline optimizer");

program
  .command("run")
  .requiredOption("--profile <name>", "profile name to produce")
  .option("--gold <dir>", "gold set directory", "autotune/gold")
  .option("--base <dir>", "autotune base directory (profiles/ledger)", "autotune")
  .option("--floor <n>", "minimum quality 0-100", "85")
  .option("--max-iter <n>", "iteration cap", "12")
  .option("--budget <usd>", "total USD budget", "5")
  .option("--sample <n>", "records per iteration", "6")
  .option("--plateau <k>", "stop after K non-improving iterations", "3")
  .option("--langs <csv>", "target languages override (optional)")
  .option("--judge-model <m>", "judge model (pinned)", "gpt-4o")
  .option("--translator-model <m>", "translator model for pricing/default", "gpt-4o-mini")
  .option("--dry-run", "do not flip active.json", false)
  .action(async (opts) => {
    if (!process.env.OPENAI_API_KEY) {
      console.error("ERROR: OPENAI_API_KEY not set.");
      process.exit(2);
    }
    const goldAll = loadGold(opts.gold);
    if (goldAll.length < MIN_GOLD) {
      console.error(`ERROR: need at least ${MIN_GOLD} gold records, found ${goldAll.length}.`);
      process.exit(2);
    }

    const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
    const tm = new SqliteTranslationMemory(":memory:");

    try {
    const floor = Number(opts.floor);
    const sample = Number(opts.sample);
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const seed = Date.now() & 0x7fffffff;
    const langs: string[] | undefined = opts.langs ? String(opts.langs).split(",") : undefined;

    const applyLangs = (r: GoldRecord): GoldRecord => (langs ? { ...r, targetLangs: langs } : r);
    const iterationSample = sampleRecords(goldAll, sample, seed).map(applyLangs);

    console.error(
      `[autotune] ${runId}\n` +
        `[autotune] gold=${goldAll.length} records, sample=${iterationSample.length}/iter, ` +
        `langs=${(langs ?? ["(gold default)"]).join(",")}, floor=${floor}, ` +
        `maxIter=${opts.maxIter}, budget=$${opts.budget}, judge=${opts.judgeModel}`
    );
    console.error(`[autotune] evaluating baseline (this can take a minute per record)...`);

    const active = readActiveProfile(opts.base);
    const baseline: Candidate = active
      ? { config: active.config, promptTemplates: active.promptTemplates as Candidate["promptTemplates"] }
      : { config: { models: { translator: { provider: "openai", model: opts.translatorModel }, reviewer: { provider: "openai", model: opts.translatorModel } } } };

    const ledger = (e: LedgerIteration) => {
      appendLedger(opts.base, { runId, ...e, candidate: { config: e.candidate.config, rationale: e.candidate.rationale } });
      const tag = e.decision === "baseline" ? "baseline" : `iter ${e.iter} ${e.decision}`;
      const q = e.metrics.unscoreable ? "unscoreable" : `q=${e.metrics.quality.toFixed(1)} (min ${e.metrics.qualityMin})`;
      const why = e.candidate.rationale ? ` — ${e.candidate.rationale.slice(0, 80)}` : "";
      console.error(`[autotune] ${tag}: ${q} $${e.metrics.estUsd.toFixed(4)} spend=$${e.spendSoFar.toFixed(4)}${why}`);
    };

    const result = await optimize({
      baseline,
      objective: { floor, epsilon: 0.0001 },
      maxIter: Number(opts.maxIter),
      budgetUsd: Number(opts.budget),
      plateauK: Number(opts.plateau),
      propose: (best, metrics) => propose(best, metrics, { provider, model: opts.translatorModel, maxRetries: 3 }),
      runCandidate: (c) => runCandidate(c, iterationSample, { provider, tm, judgeModel: opts.judgeModel, translatorModelForPricing: opts.translatorModel }),
      onIteration: ledger,
    });

    console.error(
      `[autotune] search done (${result.stopReason}, ${result.iterations} iters, $${result.spendUsd.toFixed(4)}). ` +
        `Validating winner on full gold set (${goldAll.length} records)...`
    );
    const fullSet = goldAll.map(applyLangs);
    const finalMetrics = await runCandidate(result.best, fullSet, {
      provider, tm, judgeModel: opts.judgeModel, translatorModelForPricing: opts.translatorModel,
    });

    const confirmed = finalMetrics.quality >= floor;
    const winnerMetrics = confirmed ? finalMetrics : result.bestMetrics;

    const version = nextVersion(opts.base, opts.profile);
    const profile: Profile = {
      name: opts.profile,
      version,
      createdAt: new Date().toISOString(),
      parentVersion: active ? active.version : null,
      config: result.best.config,
      promptTemplates: result.best.promptTemplates,
      provenance: { runId, goldSet: opts.gold, sample, langs: langs ?? [], judgeModel: opts.judgeModel, objective: { floor } },
      metrics: { quality: winnerMetrics.quality, estUsd: winnerMetrics.estUsd, gatePassRate: winnerMetrics.gatePassRate },
    };
    const profilePath = writeProfile(opts.base, profile);
    if (!opts.dryRun) setActive(opts.base, opts.profile, version);

    const outDir = join(opts.base, "out");
    mkdirSync(outDir, { recursive: true });
    const report = [
      `# Autotune run ${runId}`,
      ``,
      `| Metric | Baseline | Winner |`,
      `|---|---|---|`,
      `| Quality | ${active ? active.metrics.quality.toFixed(1) : "n/a (engine defaults)"} | ${winnerMetrics.quality.toFixed(1)} |`,
      `| Est. USD | ${active ? "$" + active.metrics.estUsd.toFixed(4) : "n/a"} | $${winnerMetrics.estUsd.toFixed(4)} |`,
      `| Gate pass rate | ${active ? active.metrics.gatePassRate.toFixed(2) : "n/a"} | ${winnerMetrics.gatePassRate.toFixed(2)} |`,
      ``,
      `**Stop reason:** ${result.stopReason}`,
      `**Iterations:** ${result.iterations}`,
      `**Total spend (search):** $${result.spendUsd.toFixed(4)}`,
      `**Winner confirmed on full gold set:** ${confirmed ? "yes" : "NO — kept search-best"}`,
      `**Winning change rationale:** ${result.best.rationale ?? "(baseline unchanged)"}`,
      `**Profile written:** ${profilePath}${opts.dryRun ? " (dry-run, not activated)" : " (active)"}`,
    ].join("\n");
    writeFileSync(join(outDir, `${runId}.md`), report);

    console.log(report);
    } finally {
      tm.close?.();
    }
  });

program
  .command("profiles")
  .option("--base <dir>", "autotune base directory", "autotune")
  .action((opts) => {
    const active = readActiveProfile(opts.base);
    console.log(active ? `active: ${active.name}-v${active.version} (quality ${active.metrics.quality}, $${active.metrics.estUsd})` : "no active profile");
  });

program
  .command("show")
  .argument("<runId>", "run id to show the report for")
  .option("--base <dir>", "autotune base directory", "autotune")
  .action((runId, opts) => {
    const path = join(opts.base, "out", `${runId}.md`);
    if (!existsSync(path)) { console.error(`no report at ${path}`); process.exit(1); }
    console.log(readFileSync(path, "utf8"));
  });

program.parseAsync(process.argv);
