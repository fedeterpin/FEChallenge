"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ROLES } from "@/db/permissions";
import type { Display, Row } from "@/agent/artifact";
import {
  getActiveRole,
  getActiveWorkspace,
  useTenant,
  useTRPC,
} from "./providers";

export default function Page() {
  const { activeWorkspace, setActiveWorkspace, role, setRole } = useTenant();
  const trpc = useTRPC();

  const workspaces = useQuery(trpc.workspaces.list.queryOptions());
  const pipeline = useQuery(trpc.analytics.applicationsByStage.queryOptions({}));

  // A fresh transport per active workspace/role so the `x-workspace` + `x-role`
  // headers follow the switchers. Keying useChat on them also resets the
  // conversation when you switch tenant or role.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: () => ({
          "x-workspace": getActiveWorkspace(),
          "x-role": getActiveRole(),
        }),
      }),
    [activeWorkspace, role],
  );

  const { messages, sendMessage, status } = useChat({
    id: `${activeWorkspace}:${role}`,
    transport,
  });

  const [input, setInput] = useState("");
  const busy = status === "streaming" || status === "submitted";

  function submit(e: React.SubmitEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <main className="mx-auto grid h-screen max-w-6xl grid-cols-[1fr_320px] gap-4 p-4">
      {/* Conversation column */}
      <section className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">ATS Analytics Copilot</h1>
            <p className="text-xs text-gray-500">
              Chat with this workspace&rsquo;s recruiting data.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">Workspace</span>
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                value={activeWorkspace}
                onChange={(e) => setActiveWorkspace(e.target.value)}
              >
                {workspaces.data?.map((w) => (
                  <option key={w.id} value={w.slug}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-gray-500">Role</span>
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400">
              Ask about this workspace &mdash; e.g. &ldquo;How does my pipeline
              look by stage?&rdquo; or &ldquo;Where are candidates coming
              from?&rdquo;
            </p>
          )}

          {messages.map((message) => (
            <div key={message.id} className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                {message.role}
              </div>
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <p
                      key={i}
                      className="whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 text-sm"
                    >
                      {part.text}
                    </p>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  return <ToolCall key={i} part={part} />;
                }
                return null;
              })}
            </div>
          ))}

          {busy && <p className="text-xs text-gray-400">Copilot is working&hellip;</p>}
        </div>

        <form
          onSubmit={submit}
          className="flex items-center gap-2 border-t border-gray-200 px-4 py-3"
        >
          <input
            className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Ask the analytics copilot…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </section>

      {/* Side panel: a reference scoped read via tRPC (pipeline by stage). */}
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Pipeline (this workspace)</h2>
          {pipeline.data && pipeline.data.length > 0 ? (
            <ul className="space-y-1">
              {pipeline.data.map((row) => (
                <li key={row.stage} className="flex justify-between text-xs">
                  <span className="font-medium">{row.stage}</span>
                  <span className="text-gray-400">{Number(row.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">No data.</p>
          )}
        </div>
      </aside>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Generative UI. Each tool returns `{ rows, display }`; we render a component
// per `display.kind` (bar | line | table) and surface the tool-call lifecycle:
// calling… (skeleton) → result → empty → error.
// ---------------------------------------------------------------------------
type ToolPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: { rows?: Row[]; display?: Display };
  errorText?: string;
};

function ToolCall({ part }: { part: unknown }) {
  const p = part as ToolPart;
  const name = p.type.replace(/^tool-/, "");
  const done = p.state === "output-available";
  const errored = p.state === "output-error";

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="flex items-center gap-1.5 font-medium text-gray-600">
        <span
          className={
            errored
              ? "h-1.5 w-1.5 rounded-full bg-red-500"
              : done
                ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
                : "h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"
          }
        />
        {name}
        <span className="font-normal text-gray-400">
          {errored ? "· error" : done ? "· result" : "· calling…"}
        </span>
      </div>
      {errored && <p className="mt-1 text-red-500">{p.errorText}</p>}
      {!done && !errored && <Skeleton />}
      {done && <Artifact output={p.output} />}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-2 space-y-1.5">
      {[60, 85, 45].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-gray-100"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

function Artifact({ output }: { output?: { rows?: Row[]; display?: Display } }) {
  const rows = output?.rows ?? [];
  const display = output?.display;
  if (!display) return <p className="mt-1 text-gray-400">No data.</p>;
  if (rows.length === 0) return <p className="mt-1 text-gray-400">No rows.</p>;

  if (display.kind === "bar") return <BarChart rows={rows} display={display} />;
  if (display.kind === "line") return <LineChart rows={rows} display={display} />;
  return <DataTable rows={rows} columns={display.columns} />;
}

function BarChart({
  rows,
  display,
}: {
  rows: Row[];
  display: Extract<Display, { kind: "bar" }>;
}) {
  const data = rows.map((r) => ({
    label: String(r[display.x] ?? ""),
    value: Number(r[display.y] ?? 0),
  }));
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <figure className="mt-2">
      <figcaption className="mb-2 font-medium text-gray-600">
        {display.title}
      </figcaption>
      <div className="space-y-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div
              className="w-28 shrink-0 truncate text-gray-500"
              title={d.label}
            >
              {d.label}
            </div>
            <div className="relative h-4 flex-1 rounded bg-gray-100">
              <div
                className="absolute inset-y-0 left-0 rounded bg-gray-800"
                style={{ width: `${(d.value / max) * 100}%` }}
              />
            </div>
            <div className="w-10 shrink-0 text-right tabular-nums text-gray-600">
              {d.value}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

function LineChart({
  rows,
  display,
}: {
  rows: Row[];
  display: Extract<Display, { kind: "line" }>;
}) {
  const data = rows.map((r) => ({
    label: String(r[display.x] ?? ""),
    value: Number(r[display.y] ?? 0),
  }));
  const w = 320;
  const h = 120;
  const pad = 10;
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = data.length > 1 ? pad + i * stepX : w / 2;
    const y = h - pad - (d.value / max) * (h - pad * 2);
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  return (
    <figure className="mt-2">
      <figcaption className="mb-2 font-medium text-gray-600">
        {display.title}
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img">
        {data.length > 1 && (
          <path d={path} fill="none" stroke="#1f2937" strokeWidth="1.5" />
        )}
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.5" fill="#1f2937" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{data[0]?.label}</span>
        {data.length > 1 && <span>{data[data.length - 1]?.label}</span>}
      </div>
    </figure>
  );
}

function DataTable({ rows, columns }: { rows: Row[]; columns: string[] }) {
  const cols = columns.length > 0 ? columns : Object.keys(rows[0]);
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-gray-400">
            {cols.map((c) => (
              <th
                key={c}
                className="border-b border-gray-100 py-1 pr-3 font-medium"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((row, i) => (
            <tr key={i} className="text-gray-600">
              {cols.map((c) => (
                <td key={c} className="border-b border-gray-50 py-1 pr-3">
                  {String(row[c] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 12 && (
        <p className="mt-1 text-[10px] text-gray-400">
          Showing 12 of {rows.length} rows.
        </p>
      )}
    </div>
  );
}
