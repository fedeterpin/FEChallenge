import { count, desc, eq, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "./client";
import { canReadColumn, type Role } from "./permissions";
import { applications, candidates, jobs } from "./schema";
import { scoped, type AnalyticsCtx } from "./scoped";

/**
 * Scoped analytics data layer for the copilot.
 *
 * Two hard requirements for everything here:
 *  1. TENANT SCOPING — every read is constrained to `ctx.workspaceId`. Reads go
 *     through the `scoped(ctx)` gateway (see `src/db/scoped.ts`): single-table
 *     reads via `scoped(ctx).select(...).from(table)` (scope injected for you),
 *     joins via `scoped(ctx).where(table, …)`. A query can't be expressed
 *     without its tenant scope.
 *  2. PERMISSIONS — candidate PII (name / email / phone) is gated by role; an
 *     `analyst` may not read it. The projection (`candidateSelection`) omits
 *     those columns entirely, so a leak is unrepresentable (see `permissions.ts`).
 *
 * `ctx` is the first parameter on every function on purpose.
 */

export type { AnalyticsCtx };

/**
 * REFERENCE QUERY: applications grouped by pipeline stage, scoped to the
 * caller's workspace. `scoped(ctx).select(...).from(...)` injects the workspace
 * filter; `jobId` is passed as an extra predicate.
 */
export async function applicationCountByStage(
  ctx: AnalyticsCtx,
  opts: { jobId?: string } = {},
) {
  const extra = opts.jobId ? [eq(applications.jobId, opts.jobId)] : [];
  return scoped(ctx)
    .select({ stage: applications.stage, count: count() })
    .from(applications, ...extra)
    .groupBy(applications.stage)
    .orderBy(desc(count()));
}

/** Candidate counts grouped by acquisition source (referral, linkedin, …). */
export async function candidatesBySource(ctx: AnalyticsCtx) {
  return scoped(ctx)
    .select({ source: candidates.source, count: count() })
    .from(candidates)
    .groupBy(candidates.source)
    .orderBy(desc(count()));
}

/**
 * Applications bucketed over time by `appliedAt`. `bucket` is whitelisted to
 * `week` | `month` and bound as a parameter to `date_trunc`, so there's no
 * injection surface even though it shapes SQL.
 */
export async function applicationsOverTime(
  ctx: AnalyticsCtx,
  opts: { bucket?: "week" | "month" } = {},
) {
  const bucket = opts.bucket === "week" ? "week" : "month";
  const period = sql<string>`to_char(date_trunc(${bucket}, ${applications.appliedAt}), 'YYYY-MM-DD')`;
  // GROUP BY / ORDER BY the SELECT's ordinal position. `period` embeds a bound
  // parameter (the whitelisted bucket); repeating that expression in GROUP BY
  // would render a second, distinct placeholder, so Postgres would reject the
  // non-aggregated `applied_at`. Referencing position 1 keeps them identical.
  return scoped(ctx)
    .select({ period, count: count() })
    .from(applications)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
}

/**
 * Every job with its application count — the at-a-glance requisition table.
 * A join: the `from`/`leftJoin` is assembled directly, but the mandatory
 * workspace predicate still comes from the gateway (`scoped(ctx).where`).
 */
export async function jobsOverview(ctx: AnalyticsCtx) {
  return db
    .select({
      title: jobs.title,
      department: jobs.department,
      location: jobs.location,
      status: jobs.status,
      applications: count(applications.id),
    })
    .from(jobs)
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(scoped(ctx).where(jobs))
    .groupBy(jobs.id, jobs.title, jobs.department, jobs.location, jobs.status)
    .orderBy(desc(count(applications.id)));
}

/**
 * The PII boundary, enforced by construction. Builds the Drizzle select object
 * for `candidates`, OMITTING any column the role can't read (see
 * `canReadColumn`). An `analyst`'s query literally has no name/email/phone in
 * its projection, so those columns are never read from the DB — a leak is
 * unrepresentable, not filtered out afterwards.
 */
function candidateSelection(ctx: AnalyticsCtx): Record<string, PgColumn> {
  const all: Record<string, PgColumn> = {
    id: candidates.id,
    name: candidates.name,
    email: candidates.email,
    phone: candidates.phone,
    source: candidates.source,
    createdAt: candidates.createdAt,
  };

  const projection: Record<string, PgColumn> = {};
  for (const key of Object.keys(all)) {
    if (canReadColumn(ctx.role, "candidates", key)) projection[key] = all[key];
  }
  return projection;
}

/** Which candidate columns the role may see — used for the table `display`. */
export function visibleCandidateColumns(role: Role): string[] {
  return ["id", "name", "email", "phone", "source", "createdAt"].filter((c) =>
    canReadColumn(role, "candidates", c),
  );
}

/**
 * Individual candidates for this workspace. PII-gated: an `analyst` receives
 * rows with no name/email/phone (see `candidateSelection`).
 */
export async function listCandidates(
  ctx: AnalyticsCtx,
  opts: { limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  return scoped(ctx)
    .select(candidateSelection(ctx))
    .from(candidates)
    .orderBy(desc(candidates.createdAt))
    .limit(limit);
}

/**
 * Average days from application to hire, per job (uses `hired` applications'
 * `appliedAt`→`updatedAt` span as the time-to-hire proxy). A join; scope comes
 * from `scoped(ctx).where`, with `stage = 'hired'` as an extra predicate.
 */
export async function timeToHireByJob(ctx: AnalyticsCtx) {
  const avgDays = sql<number>`round(avg(extract(epoch from (${applications.updatedAt} - ${applications.appliedAt})) / 86400))`;
  return db
    .select({ title: jobs.title, avgDays })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(scoped(ctx).where(applications, eq(applications.stage, "hired")))
    .groupBy(jobs.id, jobs.title)
    .orderBy(jobs.title);
}
