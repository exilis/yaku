# yaku Core — Decision Log

**Spec:** `docs/allium/yaku-core.allium`
**Date:** 2026-06-26

This log records *why* the core behavioral spec is shaped the way it is. Entity
definitions, fields, rules, and invariants live in the allium spec; test
strategy and implementation steps live in the design spec and plan
(`2026-06-26-yaku-translation-engine-design.md`, `.../plans/...`).

## Context

The allium spec was written by *retrofitting* a behavioral contract onto an
already-implemented engine (35 tasks, 148 passing tests). It is therefore scoped
to the engine's load-bearing guarantees rather than driving new development.

## Why these behaviors, scoped to core only

- **Core, not surfaces.** The CLI, HTTP API, and MCP server are deliberately
  thin wrappers that share `@yaku/core`'s Zod contract and call `translate()`.
  They carry no translation logic, so specifying core captures the real
  observable behavior once, without duplicating it three times. Surface-level
  transport contracts (exit codes, HTTP status mapping, MCP tool registration)
  were considered and **rejected** for v1 spec scope: they are transport glue,
  already covered by per-surface tests, and would dilute the spec with
  non-behavioral detail.

## Key decisions captured as invariants

- **Round-trip id completeness** is the engine's central promise: the motivating
  use case is translating fields scattered across DB columns and writing each
  result back to its origin. Every input id must appear exactly once per
  language. This is the first invariant for that reason.

- **Language-independent sourceHash** was chosen over a per-(text,lang) key so
  that incremental re-runs and cross-language consistency share one anchor.
  Rejected alternative: hashing source+targetLang together, which would have
  prevented detecting that "this English string is unchanged" across all locales
  in one comparison.

- **Per-segment failure degrades to `partial`, never `failed`.** A stubborn or
  erroring segment must not sink an otherwise-good document. `failed` at the
  language/document level is reserved for total failure. This was an explicit
  correction during implementation (the first draft of the document-status
  logic incorrectly returned `failed` when all segments failed in a single-
  segment doc); the invariant pins the intended behavior.

- **Commit-only-accepted-to-memory.** Best-so-far results (max-iterations,
  budget-hit) are never written to the translation memory, so a degraded
  translation cannot poison future reuse. Back-translation-ok *is* committed,
  but only after the revised draft is re-gated — an explicit safety fix made
  during review.

- **Reused-skips-the-model** and **deterministic-gates-before-reviewer** encode
  the cost discipline: exact TM hits cost zero LLM calls, and cheap mechanical
  checks run before the expensive independent reviewer.

## External constraints

- Output must be JSON-serializable and keyed by stable segment ids (DB
  write-back contract).
- The translation memory is shared, mutable state; its namespace sentinel must
  be uncollidable with user namespaces (implemented as a NUL-prefixed sentinel).

## Propagated obligations

`allium plan` produces ~31 obligations (entity-field, status-transition,
invariant, and rule checks). Because this spec was retrofitted onto a complete,
tested engine, the obligations map onto existing tests rather than driving new
ones; the engine's `contract.test.ts` already asserts the three headline
invariants (round-trip ids, do-not-translate verbatim, cross-language
sourceHash), and the per-subsystem suites cover the rule behaviors (reuse skips
the model, fresh translation, per-segment failure → partial, commit-on-accept,
max-iterations best-so-far). No new stub-wiring task is required — the behaviors
are already covered. CI runs `allium check` to keep the spec from drifting from
the code.

## Spec language notes

Written against Allium v3 (`-- allium: 3`): inline enum unions for status
fields, `transitions` blocks for the segment/language lifecycles, entity-level
`invariant` blocks, and `rule` blocks bound via `when:` events. `allium check`
reports 0 errors; the ~20 warnings are reachability/unused hints expected for a
behavioral-contract spec that intentionally does not model the full surface/
event graph (surfaces are out of scope per the header). The gate is errors-only.
