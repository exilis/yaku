# yaku

Agentic translation engine: an LLM translation pipeline with a review/refine loop,
native multi-language output, storage-agnostic structured I/O, and translation memory.
Exposed via CLI, HTTP API, and MCP.

## Why

Production translation needs more than one-shot LLM calls. yaku runs an agentic loop —
draft, deterministic quality gates, an independent LLM reviewer, optional back-translation —
and refines until the output passes or a budget is hit. Content fragmented across separate
DB fields is assembled for full context, translated together, then returned keyed by stable
segment ids so the caller writes each piece back to its own field.

## Packages

- `@yaku/core` — the engine: `translate()`, Zod I/O schemas, the agentic refine loop,
  pluggable LLM providers, pluggable SQLite/Postgres translation memory, deterministic gates.
- `@yaku/cli`  — `yaku translate` / `yaku tm` commands.
- `@yaku/api`  — HTTP server: `POST /translate`, `GET /health`.
- `@yaku/mcp`  — MCP server exposing `translate` + `tm_invalidate` tools.

## Install & build

```bash
pnpm install
pnpm build
```

## CLI

```bash
# request.json = a TranslationRequest
node packages/cli/dist/index.js translate --in request.json --out response.json --provider openai
# or pipe via stdin/stdout:
echo '{"sourceLang":"en","targetLangs":["ja","ko"],"document":{"segments":[{"id":"title","text":"Welcome"}]}}' \
  | OPENAI_API_KEY=sk-... node packages/cli/dist/index.js translate --provider openai
```

Exit codes: `0` ok, `1` partial, `2` failed. Use `--provider mock` to validate wiring without an API key.

Manage translation memory:

```bash
node packages/cli/dist/index.js tm export --tm yaku-tm.sqlite
node packages/cli/dist/index.js tm invalidate --tm yaku-tm.sqlite --target ja
```

## API

```bash
OPENAI_API_KEY=sk-... node packages/api/dist/index.js   # listens on PORT (default 3000)
curl -s localhost:3000/translate -H 'content-type: application/json' -d @request.json
```

## MCP

```bash
OPENAI_API_KEY=sk-... node packages/mcp/dist/index.js   # MCP server over stdio
```

## Request / Response shape

Input is a `TranslationRequest`: `sourceLang`, `targetLangs[]`, a `document` with `segments`
(each with a stable `id`, `text`, optional `metadata` like `group`/`order`/`maxChars`/`doNotTranslate`),
optional `context`, `glossary`, and `config`. Output is a `TranslationResponse` with one
`LanguageResult` per target language, each carrying per-segment results keyed by the same ids
(with `status`, `sourceHash`, `tmMatch`, `confidence`, `warnings`). Every input id appears exactly
once per language.

See `docs/superpowers/specs/2026-06-26-yaku-translation-engine-design.md` for the full design
and `docs/superpowers/plans/2026-06-26-yaku-translation-engine.md` for the implementation plan.

## Development

```bash
pnpm test        # run all tests
pnpm typecheck   # typecheck all packages
pnpm lint        # lint
```
