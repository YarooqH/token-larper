import React, { useMemo, useState } from "react";
import type { SessionEntry } from "../../types.ts";
import { ToolTag, useDashboard } from "../context.tsx";
import { formatDay } from "../lib/range.ts";
import { cleanProjectPath, formatCompactNumber, formatCurrency } from "../utils.ts";

const PAGE = 100;

export function sessionWhen(s: SessionEntry): string {
  if (s.lastActivity) {
    return new Date(s.lastActivity).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  return s.date === "Unknown" ? "Unknown" : formatDay(s.date, true);
}

export function matchesSession(s: SessionEntry, q: string): boolean {
  return (
    (s.projectRoot ?? s.projectPath).toLowerCase().includes(q) ||
    s.modelsUsed.some((m) => m.toLowerCase().includes(q)) ||
    s.harness.includes(q)
  );
}

export function SessionTable({ sessions, showProject = true }: { sessions: SessionEntry[]; showProject?: boolean }) {
  const { costOf, estimated } = useDashboard();
  const [limit, setLimit] = useState(PAGE);
  const shown = sessions.slice(0, limit);

  return (
    <>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Last active</th>
              <th>Tool</th>
              {showProject && <th>Project</th>}
              <th>Models</th>
              <th className="num">Input</th>
              <th className="num">Output</th>
              <th className="num">Cache read</th>
              <th className="num">Total</th>
              <th className="num">{estimated ? "Est. value" : "Cost"}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td className="nowrap">{sessionWhen(s)}</td>
                <td><ToolTag id={s.harness} /></td>
                {showProject && (
                  <td className="project-cell" title={s.cwd ?? s.projectPath}>
                    {s.projectName ? (
                      <>
                        <strong>{s.projectName}</strong>
                        <span className="cell-note">{s.projectRoot}</span>
                      </>
                    ) : (
                      <span className="muted">{cleanProjectPath(s.projectPath)}</span>
                    )}
                  </td>
                )}
                <td>
                  <div className="tag-row">
                    {s.modelsUsed.slice(0, 3).map((m) => <code key={m} className="model-name">{m}</code>)}
                    {s.modelsUsed.length > 3 && <span className="muted">+{s.modelsUsed.length - 3}</span>}
                  </div>
                </td>
                <td className="num">{formatCompactNumber(s.inputTokens)}</td>
                <td className="num">{formatCompactNumber(s.outputTokens)}</td>
                <td className="num">{formatCompactNumber(s.cacheReadTokens)}</td>
                <td className="num strong">{formatCompactNumber(s.totalTokens)}</td>
                <td className="num">{formatCurrency(costOf(s))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sessions.length > limit && (
        <div className="table-more">
          <span className="muted">Showing {limit} of {sessions.length}</span>
          <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, sessions.length - limit)} more</button>
        </div>
      )}
    </>
  );
}

export function Sessions() {
  const { sessions, search } = useDashboard();
  const q = search.trim().toLowerCase();
  const list = useMemo(() => (q ? sessions.filter((s) => matchesSession(s, q)) : sessions), [sessions, q]);

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Sessions</h2>
          <p>
            {list.length} {list.length === 1 ? "session" : "sessions"}
            {q ? ` matching “${search.trim()}”` : ""}, newest first. A session counts toward the day it was last active.
          </p>
        </div>
      </header>
      {list.length === 0 ? <p className="muted">No sessions in this range.</p> : <SessionTable key={q} sessions={list} />}
    </section>
  );
}
