import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { db } from "./client";
import type { Role } from "./permissions";

/**
 * The scoped data gateway — tenant isolation by construction.
 *
 * Every read of a tenant-owned table should be built through `scoped(ctx)`
 * rather than the raw `db`. `scoped(ctx).select(cols).from(table)` injects the
 * `workspaceId` filter automatically, so a single-table read *cannot be
 * expressed* without its tenant scope — you don't have to remember `scopeWhere`,
 * the gateway is the only entry point. Multi-table reads (joins) obtain their
 * mandatory workspace predicate from `scoped(ctx).where(table, …)`.
 *
 * Raw `db` stays available for migrations, the seed, and non-tenant tables
 * (e.g. `workspaces`). The production-grade backstop — enforcing isolation even
 * for code that reaches around this gateway — is Postgres row-level security
 * (a per-request `SET LOCAL app.workspace_id` + a `USING` policy per table).
 * See DECISIONS.md.
 */

export type AnalyticsCtx = { workspaceId: string; role: Role };

/** Any tenant-owned table carries a `workspaceId`. The gateway only accepts these. */
type TenantTable = PgTable & { workspaceId: PgColumn };

/** Drizzle select shape: a map of output keys to columns or SQL expressions. */
type Columns = Record<string, PgColumn | SQL>;

/** The one place tenant scoping lives: AND-s the workspace filter into a query. */
function scopeWhere(
  table: TenantTable,
  ctx: AnalyticsCtx,
  extra: Array<SQL | undefined> = [],
): SQL {
  const parts = [eq(table.workspaceId, ctx.workspaceId), ...extra].filter(
    (p): p is SQL => p !== undefined,
  );
  // Always has at least the workspace filter, so it's never undefined.
  return and(...parts)!;
}

/** Bind the tenant scope to a `ctx` so every read built through it is scoped. */
export function scoped(ctx: AnalyticsCtx) {
  return {
    /**
     * Scoped single-table read. `scoped(ctx).select(cols).from(table, …extra)`
     * pre-applies the workspace filter (plus any `extra` predicates) before you
     * chain `.groupBy()/.orderBy()/.limit()`.
     */
    select<TSel extends Columns>(columns: TSel) {
      return {
        from<T extends TenantTable>(table: T, ...extra: Array<SQL | undefined>) {
          // `table as PgTable` sidesteps Drizzle's empty-selection guard on
          // `.from()` (it can't prove a *generic* selection is non-empty). The
          // result rows are still typed from `columns`, and `scopeWhere` uses
          // the precise `table` type for its `workspaceId` predicate.
          return db
            .select(columns)
            .from(table as PgTable)
            .where(scopeWhere(table, ctx, extra))
            .$dynamic();
        },
      };
    },

    /**
     * The mandatory workspace predicate for multi-table reads (joins), which
     * assemble their own `from`/`join` chain. Pass the driving (scoped) table
     * plus any extra predicates.
     */
    where(table: TenantTable, ...extra: Array<SQL | undefined>): SQL {
      return scopeWhere(table, ctx, extra);
    },
  };
}
