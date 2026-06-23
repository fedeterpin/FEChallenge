import { beforeAll, describe, expect, it } from "vitest";

import { db, ensureSchema } from "@/db/client";
import {
  applicationsOverTime,
  jobsOverview,
  listCandidates,
  type AnalyticsCtx,
} from "@/db/analytics";
import { PII_COLUMNS } from "@/db/permissions";
import { workspaces } from "@/db/schema";
import { seed } from "@/db/seed";

/**
 * "Right by construction" coverage, independent of any model. Proves the two
 * hard invariants directly against the query layer:
 *   1. tenant scoping — a Brightwave query never returns Meridian rows
 *   2. PII projection — an analyst's candidate rows omit name/email/phone
 *
 * Note: PGlite is file-backed (./.pglite) and shared with dev; this seeds when
 * empty. Run `pnpm db:seed` if you want to reset deterministic fixtures.
 */
const BRIGHTWAVE: AnalyticsCtx = { workspaceId: "brightwave", role: "admin" };

async function ensureSeeded() {
  await ensureSchema();
  const rows = await db.select().from(workspaces);
  if (rows.length === 0) await seed();
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("tenant scoping", () => {
  it("only returns this workspace's candidates", async () => {
    const rows = await listCandidates(BRIGHTWAVE, { limit: 100 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Seed ids are prefixed per workspace (bw-* vs mer-*).
      expect(String(row.id)).toMatch(/^bw-/);
    }
  });

  it("only returns this workspace's jobs", async () => {
    const titles = (await jobsOverview(BRIGHTWAVE)).map((j) => String(j.title));
    expect(titles).toContain("Senior Software Engineer"); // Brightwave
    expect(titles).not.toContain("Warehouse Lead"); // Meridian-only
  });
});

describe("PII projection (unrepresentable by construction)", () => {
  it("omits name/email/phone for analysts", async () => {
    const rows = await listCandidates(
      { workspaceId: "brightwave", role: "analyst" },
      { limit: 5 },
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const column of PII_COLUMNS.candidates) {
        expect(row).not.toHaveProperty(column);
      }
      expect(row).toHaveProperty("source"); // non-PII still selected
    }
  });

  it("includes PII for recruiters and admins", async () => {
    for (const role of ["recruiter", "admin"] as const) {
      const rows = await listCandidates(
        { workspaceId: "brightwave", role },
        { limit: 5 },
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toHaveProperty("name");
        expect(row).toHaveProperty("email");
        expect(row).toHaveProperty("phone");
      }
    }
  });
});

describe("applicationsOverTime (time bucketing)", () => {
  it("groups by month and week without a Postgres GROUP BY error", async () => {
    const month = await applicationsOverTime(BRIGHTWAVE);
    const week = await applicationsOverTime(BRIGHTWAVE, { bucket: "week" });

    expect(month.length).toBeGreaterThan(0);
    expect(week.length).toBeGreaterThan(0);
    for (const row of month) {
      expect(row).toHaveProperty("period");
      expect(Number(row.count)).toBeGreaterThan(0);
    }
  });
});
