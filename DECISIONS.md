# Decisions

## Overview

Built the copilot on top of the provided spine: a scoped query layer, a tool
catalog the model drives, real PII enforcement, a generative chart/table UI, and
benchmarks for the two hard invariants (tenant isolation + permissions). The repo
still boots with zero config on the mock model; pointing `AI_PROVIDER=anthropic`
runs the real agent against the same tools and evals.

State: core scope is complete and green — `pnpm typecheck`, `pnpm test` (8 unit
tests), `pnpm eval` (9 eval cases, 100% on the mock), and `pnpm build` all pass.

## Architecture & key decisions

- **Tool catalog** (`src/agent/tools.ts`) — six tools, one per analytics question
  a hiring team actually asks: `applicationCountByStage` (funnel),
  `candidatesBySource` (sourcing mix), `applicationsOverTime` (trend),
  `jobsOverview` (requisition table), `listCandidates` (people, PII-gated), and
  `timeToHireByJob` (velocity). Each maps to exactly one query and one `display`
  hint. Descriptions are **prescriptive about *when* to call** ("call this when the
  user asks about…"), since current Anthropic models reach for tools conservatively.
  All inputs are **optional** — the mock model calls tools with empty args, so
  optional params keep offline boot working while still letting the real model pass
  `jobId`, `bucket`, or `limit`.
- **Query layer** (`src/db/analytics.ts`) — each function is a small, composable
  read that takes `ctx` as argument #1, builds on the `scoped(ctx)` gateway so every
  read is workspace-scoped (see *Tenant scoping* below) and gated on `ctx.role` for
  candidate PII (see *Permissions*), and returns plain rows. No SQL leaks above this
  layer; tools never build queries.
- **Tenant scoping — one gateway, with room to harden** — reads go through a
  `scoped(ctx)` gateway (`src/db/scoped.ts`), not the raw `db`.
  `scoped(ctx).select(cols).from(table)` injects the workspace filter, so a
  single-table read *can't be expressed* unscoped; joins take their mandatory
  workspace predicate from `scoped(ctx).where(table, …)`. Raw `db` is reserved for
  migrations/seed/non-tenant tables (`workspaces`). This turns per-query discipline
  into one enforced doorway — better than the original convention of calling
  `scopeWhere` by hand. It still *relies* on developers using the gateway, though:
  the production-grade backstop is Postgres **row-level security** (per-request
  `SET LOCAL app.workspace_id` + a `USING` policy per table), which enforces
  isolation even for code that bypasses the gateway. Left as the documented next
  step — PGlite's single shared connection makes the per-request GUC fiddly (you'd
  set it inside a transaction). Joins also stay safe because the join key
  (`jobId`/`candidateId`) is itself workspace-local.
- **Permissions — PII unrepresentable by construction** (`src/db/permissions.ts`
  + `analytics.ts`) — `PII_COLUMNS` is the single source of truth.
  `canReadColumn(role, table, col)` is the one decision point; `candidateSelection(ctx)`
  consumes it to build the Drizzle **projection**, *omitting* name/email/phone
  entirely for analysts. An analyst's query never selects those columns from the DB
  — a leak isn't filtered out after the fact, it can't be produced. The table
  `display.columns` is derived from the same predicate so the UI matches the rows.
- **Fail closed on role** — the request context defaults to *least privilege*: an
  absent or unrecognized `x-role` resolves to `analyst` (no PII), never `admin`
  (`DEFAULT_ROLE` in `permissions.ts`, consumed by `context.ts`). A missing role
  shouldn't hand out the most access. The demo UI opts into `admin` explicitly via
  the Role switcher — a demo posture, not a security one; the server decides access.
  (In real auth a missing role is a 401, not a fallback at all.)
- **Generative UI** (`src/app/page.tsx`) — components keyed on `display.kind`:
  hand-rolled SVG `line` chart, CSS bar chart, styled table. No chart dependency
  (small surface, streams cleanly, full control). The tool-call lifecycle renders
  as `calling…` (skeleton) → result → empty → error, off the AI SDK tool-part
  states the UI already exposes.

## Model & agent

- **Anthropic, env-driven, no code branching.** `provider.ts` already reads
  `env.ANTHROPIC_MODEL`; I only fixed stale defaults. **Dev** uses
  `claude-haiku-4-5` (cheap/fast — keeps eval runs and local iteration affordable);
  **prod** uses `claude-sonnet-4-6` (the default if unset). The mock stays the
  zero-config default so the repo boots on clone. The API key lives in `.env.local`
  (gitignored) — no secret is committed.
- **Loop** — kept `stepCountIs(6)`. A thrown tool `execute` error is surfaced by
  the AI SDK as an `output-error` tool part (the UI renders it) and the model can
  recover on the next step, so I deliberately *don't* swallow errors into a fake
  `{rows, display}` (that would violate the artifact contract) — I just added an
  `onError` log hook for visibility.
- **System prompt** tightened to: always call a tool over guessing, ground every
  claim in returned rows, keep prose to a one-line takeaway, and never name PII the
  tool didn't return (defense-in-depth on top of the projection).

## Benchmarks

Two layers, because the model-driven eval and the by-construction guarantee catch
different failures:

- **Vitest units (no model, deterministic)** — `src/db/__tests__/analytics.test.ts`
  proves a Brightwave query never returns Meridian rows (id prefixes, job titles)
  and that the analyst projection omits PII while recruiters/admins keep it;
  `src/db/__tests__/permissions.test.ts` pins `canReadColumn`. This is the "right by construction"
  proof, independent of any model.
- **Evalite (runs on mock; flip to the real agent with `AI_PROVIDER=anthropic`)** —
  *Tenant isolation*: ground truth is built by calling the analytics layer directly
  with Meridian's scope; the scorer fails if any Brightwave answer carries a
  Meridian-only id (`mer-*`) or job title. *Permissions*: run as `analyst`, the
  scorer fails if any tool-result row contains a `PII_COLUMNS.candidates` key — and
  it's tested against an adversarial prompt ("give me the names and emails…").
  Both are real: I confirmed the analyst run returns candidate rows with only
  `id`/`source`, no contact fields.

## Trade-offs & cuts

- **PGlite is file-backed and single-instance.** Test files raced on `./.pglite`
  and the WASM engine aborted, so I set `fileParallelism: false` in
  `vitest.config.ts`. Fine for a take-home; a real setup would give each suite its
  own ephemeral DB.
- **No answer-quality eval.** The deterministic scorers de-risk the invariants; an
  LLM-as-judge `answerCorrectness` scorer is the obvious next add once a real key is
  wired (stubbed as a comment in the eval file).
- **`timeToHireByJob`** uses the `appliedAt`→`updatedAt` span of `hired`
  applications as a proxy (the schema has no explicit `hiredAt`).
- **Prompt caching not wired.** Anthropic `cache_control: ephemeral` would re-read
  the `tools`+`system` prefix from cache (~0.1× input cost) across the 6-step agent
  loop and across turns. Skipped for now because the static prefix (system + 6 tools
  ≈ 1.2K tokens) sits below the per-model cacheable minimum (2K on Sonnet 4.6, 4K on
  Haiku 4.5), so it only starts paying off once a conversation grows past that — a
  one-line `providerOptions.anthropic.cacheControl` to add when chats get longer.
- **With another day:** Postgres row-level security as the tenant-isolation
  backstop (so scoping survives even a query that bypasses the gateway),
  structured/typed final answers from the agent, response caching, a deploy to
  Railway (PGlite won't survive serverless — it needs a persistent volume or a
  hosted-Postgres swap), and per-job drill-down UI.

## Working with the agent

- **Delegated:** the repetitive query/tool/chart scaffolding and test boilerplate —
  the work is uniform once the `scopeWhere` + projection pattern is set.
- **Caught and overrode:** the agent's first instinct was to add a `try/catch` in
  each tool returning a fake `{rows, display}` on error — that silently corrupts the
  artifact contract; I kept errors surfacing as the SDK's `output-error` part
  instead. It also reached for a name/title-based tenant fingerprint in the eval,
  which would false-positive because the seed reuses the same name pool across
  workspaces — switched to id-prefix + workspace-unique titles.
- **Never delegated:** the shape of the PII boundary (projection-omission vs.
  post-filtering) and the model choice/split — those are the load-bearing decisions
  the whole exercise is graded on.

## Hours

~4 hours.
