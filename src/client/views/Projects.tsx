import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "../components/Icons.tsx";
import { ShareBar, ToolTag, pct, useDashboard } from "../context.tsx";
import { groupProjects } from "../lib/aggregate.ts";
import { formatCompactNumber, formatCurrency } from "../utils.ts";
import { SessionTable, matchesSession, sessionWhen } from "./Sessions.tsx";

export function Projects() {
  const { sessions, search, costOf, estimated, nameOf } = useDashboard();
  const [open, setOpen] = useState<string | null>(null);
  const q = search.trim().toLowerCase();
  const all = useMemo(() => groupProjects(sessions), [sessions]);
  const projects = useMemo(
    () => (q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.sessions.some((s) => matchesSession(s, q))) : all),
    [all, q]
  );
  const total = all.reduce((acc, p) => acc + p.totalTokens, 0);
  const attributed = all.filter((p) => p.root).reduce((acc, p) => acc + p.totalTokens, 0);
  const max = all[0]?.totalTokens ?? 0;

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Projects</h2>
          <p>
            Sessions grouped by repository. {pct(attributed, total, 0)} of tokens in this range are tied to a project;
            tools that don't record a working directory are listed separately.
          </p>
        </div>
      </header>
      {projects.length === 0 ? (
        <p className="muted">No sessions in this range.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Tools</th>
                <th className="bar-col"><span className="sr-only">Share</span></th>
                <th className="num">Sessions</th>
                <th className="num">Tokens</th>
                <th className="num">Share</th>
                <th className="num">{estimated ? "Est. value" : "Cost"}</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const isOpen = open === p.key;
                return (
                  <React.Fragment key={p.key}>
                    <tr className={`row-button ${isOpen ? "is-open" : ""}`} onClick={() => setOpen(isOpen ? null : p.key)}>
                      <td className="project-cell">
                        <button type="button" className="cell-button" aria-expanded={isOpen}>
                          {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                          <strong className={p.root ? "" : "muted"}>
                            {p.root ? p.name : `No project recorded · ${nameOf(p.harnesses[0]!)}`}
                          </strong>
                        </button>
                        {p.root && <span className="cell-note" title={p.root}>{p.root}</span>}
                      </td>
                      <td><div className="tag-row">{p.harnesses.map((h) => <ToolTag key={h} id={h} />)}</div></td>
                      <td className="bar-col"><ShareBar value={p.totalTokens} max={max} /></td>
                      <td className="num">{p.sessions.length}</td>
                      <td className="num strong">{formatCompactNumber(p.totalTokens)}</td>
                      <td className="num muted">{pct(p.totalTokens, total)}</td>
                      <td className="num">{formatCurrency(costOf(p))}</td>
                      <td className="nowrap muted">{sessionWhen(p.sessions[0]!)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="detail-row">
                        <td colSpan={8}>
                          <SessionTable sessions={p.sessions} showProject={false} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
