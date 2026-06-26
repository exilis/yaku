#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { createProvider, createTranslationMemory, type TranslateDeps } from "@yaku/core";
import { runTranslate } from "./translate-cmd.js";

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
  .action(async (opts) => {
    const raw = opts.in ? readFileSync(opts.in, "utf8") : readFileSync(0, "utf8");
    const request = JSON.parse(raw);
    if (opts.trace) request.config = { ...(request.config ?? {}), trace: opts.trace };

    const deps: TranslateDeps = {
      provider: createProvider({ provider: opts.provider }),
      tm: createTranslationMemory({ backend: "sqlite", path: opts.tm }),
    };
    const res = await runTranslate(request, deps);
    const out = JSON.stringify(res, null, 2);
    if (opts.out) writeFileSync(opts.out, out);
    else process.stdout.write(out + "\n");

    process.exit(res.status === "ok" ? 0 : res.status === "partial" ? 1 : 2);
  });

program.parseAsync(process.argv);
