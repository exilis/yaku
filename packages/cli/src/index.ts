#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { createProvider, createTranslationMemory, type TranslateDeps } from "@yaku/core";
import { runTranslate } from "./translate-cmd.js";
import { tmInvalidate, tmExport, tmImport } from "./tm-cmd.js";
import { statusToExitCode } from "./exit-code.js";

const program = new Command();
program.name("yaku").description("Agentic translation engine").version("0.1.0");

program
  .command("translate")
  .description("Translate a structured request")
  .option("--in <file>", "input request JSON file (default: stdin)")
  .option("--out <file>", "output response JSON file (default: stdout)")
  .option("--provider <name>", "LLM provider", "openai")
  .option("--tm <path>", "SQLite TM path", ":memory:")
  .option("--trace <level>", "none|summary|full")
  .option("--source <lang>", "override source language")
  .option("--target <langs>", "override target languages (comma-separated)")
  .action(async (opts) => {
    const raw = opts.in ? readFileSync(opts.in, "utf8") : readFileSync(0, "utf8");
    const request = JSON.parse(raw);
    if (opts.trace) request.config = { ...(request.config ?? {}), trace: opts.trace };
    if (opts.source) request.sourceLang = opts.source;
    if (opts.target) request.targetLangs = String(opts.target).split(",").map((s: string) => s.trim()).filter(Boolean);

    const deps: TranslateDeps = {
      provider: createProvider({ provider: opts.provider }),
      tm: createTranslationMemory({ backend: "sqlite", path: opts.tm }),
    };
    const res = await runTranslate(request, deps);
    const out = JSON.stringify(res, null, 2);
    if (opts.out) writeFileSync(opts.out, out);
    else process.stdout.write(out + "\n");

    process.exit(statusToExitCode(res.status));
  });

const tmCmd = program.command("tm").description("Manage translation memory");
tmCmd
  .command("invalidate")
  .option("--tm <path>", "SQLite TM path", ":memory:")
  .option("--source <lang>")
  .option("--target <lang>")
  .option("--namespace <ns>")
  .action(async (o) => {
    const tm = createTranslationMemory({ backend: "sqlite", path: o.tm });
    await tmInvalidate(tm, { sourceLang: o.source, targetLang: o.target, namespace: o.namespace });
  });
tmCmd
  .command("export")
  .option("--tm <path>", "SQLite TM path", ":memory:")
  .action(async (o) => {
    const tm = createTranslationMemory({ backend: "sqlite", path: o.tm });
    process.stdout.write(JSON.stringify(await tmExport(tm), null, 2) + "\n");
  });
tmCmd
  .command("import")
  .requiredOption("--tm <path>", "SQLite TM path")
  .option("--in <file>", "entries JSON file (default stdin)")
  .action(async (o) => {
    const raw = o.in ? readFileSync(o.in, "utf8") : readFileSync(0, "utf8");
    const tm = createTranslationMemory({ backend: "sqlite", path: o.tm });
    await tmImport(tm, JSON.parse(raw));
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`yaku: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
