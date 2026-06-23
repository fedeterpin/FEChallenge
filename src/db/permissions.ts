/**
 * Role + column-permission model for the analytics copilot.
 *
 * The copilot serves users with different roles. Some columns are PII and must
 * not be readable by every role.
 *
 * TODO(candidate): PII permissions are DEFINED here but NOT yet ENFORCED.
 * An `analyst` should never be able to read PII columns (candidate
 * name/email/phone); `recruiter` and `admin` may. Wire enforcement into the
 * query layer (src/db/analytics.ts) so it cannot be skipped — ideally make a
 * PII-leaking query for the wrong role *unrepresentable*, not merely rejected
 * after the fact. Then prove it with an eval.
 */

export const ROLES = ["admin", "recruiter", "analyst"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * Default role when none is supplied on the request. Least-privilege on
 * purpose: an absent or unrecognized role fails CLOSED to `analyst` (no PII),
 * never open to `admin`. In production the role comes from the verified session
 * and a missing one is a 401 — this fallback only guards the mocked-auth path.
 */
export const DEFAULT_ROLE: Role = "analyst";

/** Columns considered PII, keyed by table. Reading these requires a non-analyst role. */
export const PII_COLUMNS: Record<string, readonly string[]> = {
  candidates: ["name", "email", "phone"],
};

/**
 * Whether `role` may read `table.column`.
 *
 * Enforcement is driven entirely by `PII_COLUMNS` (the single source of truth):
 * a column is readable unless it is PII for `table` AND the caller is an
 * `analyst`. `recruiter` and `admin` may read everything.
 *
 * This predicate is the one decision point. The query layer (src/db/analytics.ts)
 * consumes it to *omit* PII columns from the projection entirely — so a leaking
 * query for the wrong role is unrepresentable, not merely rejected after the fact.
 */
export function canReadColumn(role: Role, table: string, column: string): boolean {
  const piiColumns = PII_COLUMNS[table];
  const isPii = piiColumns?.includes(column) ?? false;
  if (!isPii) return true;
  return role !== "analyst";
}
