import { and, count, desc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { db } from "./client";
import { canReadColumn, type Role } from "./permissions";
import { applications, candidates, jobs } from "./schema";

/**
 * Scoped analytics data layer for the copilot.
 *
 * This ships with ONE worked example — `applicationCountByStage` — as a
 * reference pattern. Designing the rest of the query layer the copilot needs is
 * part of the exercise (e.g. applications over time, candidates by source,
 * time-to-hire, per-job breakdowns, individual candidates, …).
 *
 * Two hard requirements for everything you add here:
 *  1. TENANT SCOPING — every query is constrained to `ctx.workspaceId`. A query
 *     must never read another workspace's rows. (Route scoping through one
 *     place — see `scopeWhere` — so it can't be forgotten as you add queries.)
 *  2. PERMISSIONS — candidate PII (name / email / phone) must be gated by role;
 *     an `analyst` may not read it (see `src/db/permissions.ts`).
 *
 * The benchmark in `evals/run.ts` verifies both against whatever tools you build.
 */

export type AnalyticsCtx = { workspaceId: string; role: Role };

/** The one place tenant scoping lives: AND-s the workspace filter into a query. */
function scopeWhere(
  table: { workspaceId: AnyColumn },
  ctx: AnalyticsCtx,
  extra: Array<SQL | undefined> = [],
): SQL {
  const parts = [eq(table.workspaceId, ctx.workspaceId), ...extra].filter(
    (p): p is SQL => p !== undefined,
  );
  // Always has at least the workspace filter, so it's never undefined.
  return and(...parts)!;
}

/**
 * REFERENCE QUERY: applications grouped by pipeline stage, scoped to the
 * caller's workspace. Use it as the template for the rest of the layer.
 *
 * `ctx` comes first on purpose: a query can't even be expressed without the
 * tenant scope, so it can't be forgotten.
 */
export async function applicationCountByStage(
  ctx: AnalyticsCtx,
  opts: { jobId?: string } = {},
) {
  const extra = opts.jobId ? [eq(applications.jobId, opts.jobId)] : [];
  return db
    .select({ stage: applications.stage, count: count() })
    .from(applications)
    .where(scopeWhere(applications, ctx, extra))
    .groupBy(applications.stage)
    .orderBy(desc(count()));
}

/** Candidate counts grouped by acquisition source (referral, linkedin, …). */
export async function candidatesBySource(ctx: AnalyticsCtx) {
  return db
    .select({ source: candidates.source, count: count() })
    .from(candidates)
    .where(scopeWhere(candidates, ctx))
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
  return db
    .select({ period, count: count() })
    .from(applications)
    .where(scopeWhere(applications, ctx))
    .groupBy(period)
    .orderBy(period);
}

/** Every job with its application count — the at-a-glance requisition table. */
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
    .where(scopeWhere(jobs, ctx))
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
function candidateSelection(ctx: AnalyticsCtx) {
  const all = {
    id: candidates.id,
    name: candidates.name,
    email: candidates.email,
    phone: candidates.phone,
    source: candidates.source,
    createdAt: candidates.createdAt,
  } as const;

  const projection: Partial<Record<keyof typeof all, (typeof all)[keyof typeof all]>> =
    {};
  for (const key of Object.keys(all) as Array<keyof typeof all>) {
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
  return db
    .select(candidateSelection(ctx))
    .from(candidates)
    .where(scopeWhere(candidates, ctx))
    .orderBy(desc(candidates.createdAt))
    .limit(limit);
}

/**
 * Average days from application to hire, per job (uses `hired` applications'
 * `appliedAt`→`updatedAt` span as the time-to-hire proxy).
 */
export async function timeToHireByJob(ctx: AnalyticsCtx) {
  const avgDays = sql<number>`round(avg(extract(epoch from (${applications.updatedAt} - ${applications.appliedAt})) / 86400))`;
  return db
    .select({ title: jobs.title, avgDays })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(scopeWhere(applications, ctx, [eq(applications.stage, "hired")]))
    .groupBy(jobs.id, jobs.title)
    .orderBy(jobs.title);
}
