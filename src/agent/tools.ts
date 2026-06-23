import { tool } from "ai";
import { z } from "zod";

import {
  applicationCountByStage,
  applicationsOverTime,
  candidatesBySource,
  jobsOverview,
  listCandidates,
  timeToHireByJob,
  visibleCandidateColumns,
  type AnalyticsCtx,
} from "@/db/analytics";
import type { Display, ToolResult } from "./artifact";

/**
 * The copilot's tool catalog — what the agent can actually do.
 *
 * This ships with ONE worked example. Designing the rest of the catalog is the
 * heart of the exercise: which tools should exist, their granularity, how their
 * inputs are shaped for a model to fill, and what each returns for the UI.
 *
 * The agent picks tools and passes high-level params — it never writes SQL.
 * Pass `ctx` to every query so results stay scoped to this workspace, and gate
 * PII by `ctx.role` (see src/db/permissions.ts). Each tool returns
 * `{ rows, display }` — see src/agent/artifact.ts.
 */
export function buildTools(ctx: AnalyticsCtx) {
  const result = (rows: ToolResult["rows"], display: Display): ToolResult => ({
    rows,
    display,
  });

  return {
    // The hiring funnel. Call this when the user asks how their pipeline looks,
    // where candidates are in the process, or about a specific stage. Pass a
    // jobId to scope to one requisition.
    applicationCountByStage: tool({
      description:
        "Count applications grouped by pipeline stage (applied, screen, interview, offer, hired, rejected). Call this when the user asks about their pipeline, funnel, or stage breakdown. Pass a jobId to scope to one job.",
      inputSchema: z.object({ jobId: z.string().optional() }),
      async execute({ jobId }) {
        const rows = await applicationCountByStage(ctx, { jobId });
        return result(rows, {
          kind: "bar",
          x: "stage",
          y: "count",
          title: jobId ? "Applications by stage (job)" : "Applications by stage",
        });
      },
    }),

    // Sourcing mix. Call this when the user asks where candidates come from,
    // which channels work, or about sourcing/lead sources.
    candidatesBySource: tool({
      description:
        "Count candidates grouped by acquisition source (referral, linkedin, job_board, agency, careers_site). Call this when the user asks where candidates are coming from or which channels perform best.",
      inputSchema: z.object({}),
      async execute() {
        const rows = await candidatesBySource(ctx);
        return result(rows, {
          kind: "bar",
          x: "source",
          y: "count",
          title: "Candidates by source",
        });
      },
    }),

    // Application volume trend. Call this for "over time", "trend", "by month",
    // or "how has hiring activity changed" questions.
    applicationsOverTime: tool({
      description:
        "Application volume over time, bucketed by week or month from the application date. Call this when the user asks about trends, volume over time, or activity by month/week.",
      inputSchema: z.object({
        bucket: z.enum(["week", "month"]).optional(),
      }),
      async execute({ bucket }) {
        const rows = await applicationsOverTime(ctx, { bucket });
        return result(rows, {
          kind: "line",
          x: "period",
          y: "count",
          title: `Applications over time (by ${bucket ?? "month"})`,
        });
      },
    }),

    // Requisitions at a glance. Call this for "my jobs", "open roles", or
    // "which jobs have the most applicants".
    jobsOverview: tool({
      description:
        "List every job (title, department, location, status) with its application count. Call this when the user asks about their open roles, requisitions, or which jobs are getting the most applicants.",
      inputSchema: z.object({}),
      async execute() {
        const rows = await jobsOverview(ctx);
        return result(rows, {
          kind: "table",
          columns: ["title", "department", "location", "status", "applications"],
        });
      },
    }),

    // Individual candidates. PII (name/email/phone) is gated by role in the
    // query layer — an analyst's rows simply don't contain those columns.
    listCandidates: tool({
      description:
        "List individual candidates in this workspace, most recent first. Call this when the user asks to see candidates, a candidate list, or specific people. Candidate contact details are only returned for roles permitted to see them.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional(),
      }),
      async execute({ limit }) {
        const rows = await listCandidates(ctx, { limit });
        return result(rows, {
          kind: "table",
          columns: visibleCandidateColumns(ctx.role),
        });
      },
    }),

    // Speed of hiring. Call this for "time to hire", "how long to fill", or
    // hiring-velocity questions.
    timeToHireByJob: tool({
      description:
        "Average days from application to hire, per job. Call this when the user asks about time to hire, hiring speed, or how long roles take to fill.",
      inputSchema: z.object({}),
      async execute() {
        const rows = await timeToHireByJob(ctx);
        return result(rows, {
          kind: "bar",
          x: "title",
          y: "avgDays",
          title: "Avg days to hire by job",
        });
      },
    }),
  };
}

export type CopilotTools = ReturnType<typeof buildTools>;
