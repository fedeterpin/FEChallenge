# Working notes (for your AI agent / you)

This is a small, runnable take-home: a multi-tenant **ATS analytics copilot**. An
AI agent chats with a hiring team about **one workspace's** recruiting data (jobs,
candidates, applications), calls tools to answer questions, and renders the results
as charts/tables.

> Make this file yours — you're expected to commit your agent config. Adjust these
> notes as you work.

## The one rule that matters most

**All data access is scoped to the caller's workspace AND role.** Every read must be
constrained to `ctx.workspaceId`, and candidate PII (name / email / phone) must be
gated by role — an `analyst` never sees it. A cross-workspace or PII leak is the
worst bug you can ship here. The reference query in `src/db/analytics.ts`
(`scopeWhere` + `applicationCountByStage`) shows the scoped pattern; extend it so
scope can't be forgotten as the layer grows. The tRPC `analytics.*` procedures pass
`ctx` correctly — mirror that.

## Conventions & guardrails (keep these true)

The copilot is built; these are the rules that keep it correct as it grows. A PR
that breaks one is a regression, not a style nit.

- **Tenant reads go through `scoped(ctx)`** (`src/db/scoped.ts`, used by
  `src/db/analytics.ts`): `scoped(ctx).select(cols).from(table)` injects the
  workspace filter, and joins take their predicate from `scoped(ctx).where(table)`.
  Raw `db` is for migrations, the seed, and non-tenant tables (`workspaces`) only —
  never a tenant read.
- **PII gating lives in the query layer, once:** `PII_COLUMNS` → `canReadColumn` →
  `candidateSelection(ctx)`, which *omits* name/email/phone for an `analyst`. Tools
  and the UI never re-derive or re-filter PII.
- **Tools never write SQL.** A tool picks a query, passes high-level params, and
  returns `{ rows, display }` (`src/agent/artifact.ts`). The query layer owns SQL.
- **Models are env-driven** — never hardcode a model id. Dev vs. prod differ by
  `ANTHROPIC_MODEL` only; the mock stays the default so the repo boots keyless.
- **Roles fail closed** — `DEFAULT_ROLE` is least-privilege (`analyst`), never
  `admin`; the UI opts into a higher role explicitly.
- **Benchmarks must catch the real thing** — build ground truth from the scoped
  layer, not the agent's own output; an eval that can't fail on a real leak is
  worse than none.
- **Tool errors surface** as the SDK's `output-error` part (the UI renders it) —
  never swallow them into a fake `{ rows, display }`.

## Build a real agent

The repo **boots** on a mock model so it runs on clone and tests stay deterministic,
but the mock is a stand-in — **build your copilot against a real model.** Set
`AI_PROVIDER` to a real provider, or route through a gateway (see `.env.example` and
`src/agent/provider.ts`). Your demo should show the real agent working.

## What's given vs. what you build

- **Given:** the schema + seed (two workspaces), the streaming agent loop, the
  provider layer, the mock (boot/tests only), a minimal chat UI, the tRPC layer, and
  **one worked tool end-to-end** as a reference.
- **You build:** the tool catalog, the query layer behind it, permission
  enforcement, the generative chart UI, and the two benchmark stubs. See `README.md`
  for the full brief.

## Repo layout

```
src/
  db/        Drizzle schema + PGlite client + seed + analytics.ts (query layer) + permissions.ts
  server/    tRPC router + context (carries workspaceId + role from headers)
  agent/     tools.ts · run.ts (streamText loop) · provider.ts · mock-model.ts · artifact.ts
  app/       chat UI, providers, /api/chat, /api/trpc
evals/       agent evals — Evalite *.eval.ts (pnpm eval)
```

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Vercel AI SDK v6 · tRPC v11 +
TanStack Query + superjson · Drizzle ORM over PGlite (in-process Postgres,
file-backed at `./.pglite`) · Tailwind v3 · TypeScript strict.

## Commands

```bash
pnpm install
pnpm db:seed      # wipe + seed the two workspaces (Brightwave, Meridian Logistics)
pnpm dev          # http://localhost:3000
pnpm eval         # run agent evals once (Evalite)
pnpm eval:dev     # Evalite watch + local UI
pnpm typecheck
pnpm test         # vitest
pnpm build
```

## Where to start

- `src/agent/tools.ts` — the reference tool; design the catalog.
- `src/db/analytics.ts` — the reference query + `scopeWhere`; build the layer.
- `src/db/permissions.ts` — enforce PII by role (it's a stub).
- `src/app/page.tsx` — turn tool results into real generative UI (currently a stub).
- `evals/copilot.eval.ts` — Evalite; flesh out the tenant-isolation & permission evals.
