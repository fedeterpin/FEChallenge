import { describe, expect, it } from "vitest";

import { ROLES, canReadColumn, PII_COLUMNS } from "./permissions";

/**
 * Pure, model-free proof of the permission predicate. The "unrepresentable"
 * projection is proven against the DB in analytics.test.ts; this just pins the
 * rule that feeds it.
 */
describe("canReadColumn", () => {
  it("hides candidate PII from analysts", () => {
    for (const column of PII_COLUMNS.candidates) {
      expect(canReadColumn("analyst", "candidates", column)).toBe(false);
    }
  });

  it("lets recruiters and admins read candidate PII", () => {
    for (const role of ["recruiter", "admin"] as const) {
      for (const column of PII_COLUMNS.candidates) {
        expect(canReadColumn(role, "candidates", column)).toBe(true);
      }
    }
  });

  it("allows non-PII columns for every role", () => {
    for (const role of ROLES) {
      expect(canReadColumn(role, "candidates", "source")).toBe(true);
      expect(canReadColumn(role, "candidates", "id")).toBe(true);
    }
  });
});
