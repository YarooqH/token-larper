import React, { useMemo, useState } from "react";
import { ShareBar, ToolTag, pct, useDashboard } from "../context.tsx";
import { harnessTotals, summarize } from "../lib/aggregate.ts";
import { formatDay } from "../lib/range.ts";
import { formatCompactNumber, formatCurrency } from "../utils.ts";

export function Tools() {
  const { data, days, harness, setHarness, costOf, estimated, seriesOf } = useDashboard();
  const [showAll, setShowAll] = useState(false);
  const tools = useMemo(() => harnessTotals(days), [days]);
  const total = useMemo(() => summarize(days).totalTokens, [days]);
  const withUsage = new Set(tools.map((t) => t.harness));
  const idle = data.harnesses.filter((h) => !withUsage.has(h.meta.id) && (showAll || h.meta.installed || h.meta.hasUsage));
  const maxTokens = tools[0]?.totalTokens ?? 0;

  return (
    <>
      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Tools with usage</h2>
            <p>Select a tool to filter the whole dashboard to it.</p>
          </div>
        </header>
        {tools.length === 0 ? (
          <p className="muted">No tool recorded usage in this range.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th className="bar-col"><span className="sr-only">Share</span></th>
                  <th className="num">Tokens</th>
                  <th className="num">Share</th>
                  <th className="num">{estimated ? "Est. value" : "Cost"}</th>
                  <th className="num">Active days</th>
                  <th className="num">Cache read</th>
                  <th>Top model</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => {
                  const meta = data.harnesses.find((h) => h.meta.id === t.harness)?.meta;
                  return (
                    <tr
                      key={t.harness}
                      className={`row-button ${harness === t.harness ? "is-selected" : ""}`}
                      onClick={() => setHarness(harness === t.harness ? "all" : t.harness)}
                    >
                      <td>
                        <button type="button" className="cell-button" aria-pressed={harness === t.harness}>
                          <ToolTag id={t.harness} />
                        </button>
                        <span className="cell-note">{meta?.vendor}</span>
                      </td>
                      <td className="bar-col"><ShareBar value={t.totalTokens} max={maxTokens} color={seriesOf(t.harness).color} /></td>
                      <td className="num strong">{formatCompactNumber(t.totalTokens)}</td>
                      <td className="num muted">{pct(t.totalTokens, total)}</td>
                      <td className="num">{formatCurrency(costOf(t))}</td>
                      <td className="num">{t.activeDays}</td>
                      <td className="num">{t.cacheHitRate.toFixed(1)}%</td>
                      <td><code className="model-name">{t.models[0]?.modelName ?? "—"}</code></td>
                      <td className="nowrap muted">{t.lastActive ? formatDay(t.lastActive, true) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>No usage in this range</h2>
            <p>
              {showAll
                ? `All ${data.totals.totalHarnesses} tools Token Larper can read.`
                : "Tools found on this computer that were idle in the selected range."}
            </p>
          </div>
          <button className="btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Only installed tools" : `Show all ${data.totals.totalHarnesses} supported tools`}
          </button>
        </header>
        {idle.length === 0 ? (
          <p className="muted">Every installed tool has usage in this range.</p>
        ) : (
          <ul className="idle-list">
            {idle.map((h) => (
              <li key={h.meta.id}>
                <div>
                  <strong>{h.meta.name}</strong>
                  <span className="muted">{h.meta.vendor}</span>
                </div>
                <code>{h.meta.configPathHint}</code>
                <span className={`status ${h.meta.installed ? "status-installed" : "status-missing"}`}>
                  {h.meta.installed
                    ? h.lastActiveDate
                      ? `Installed · last used ${formatDay(h.lastActiveDate, true)}`
                      : "Installed · never used"
                    : "Not detected"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
