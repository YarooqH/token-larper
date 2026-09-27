import React, { useMemo } from "react";
import { ShareBar, ToolTag, pct, useDashboard } from "../context.tsx";
import { modelTotals } from "../lib/aggregate.ts";
import { formatCompactNumber, formatCurrency } from "../utils.ts";

export function Models() {
  const { days, costOf, estimated, search, seriesOf } = useDashboard();
  const all = useMemo(() => modelTotals(days), [days]);
  const total = all.reduce((acc, m) => acc + m.totalTokens, 0);
  const q = search.trim().toLowerCase();
  const models = q ? all.filter((m) => m.modelName.toLowerCase().includes(q) || m.harness.includes(q)) : all;
  const max = all[0]?.totalTokens ?? 0;
  const unpriced = models.filter((m) => m.missingPricing).length;

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Models</h2>
          <p>
            {models.length} {models.length === 1 ? "model" : "models"}
            {q ? ` matching “${search.trim()}”` : ""}.
            {unpriced > 0 && ` ${unpriced} have no verified price; "Estimated API value" fills those in.`}
          </p>
        </div>
      </header>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Tool</th>
              <th className="bar-col"><span className="sr-only">Share</span></th>
              <th className="num">Input</th>
              <th className="num">Output</th>
              <th className="num">Cache read</th>
              <th className="num">Cache write</th>
              <th className="num">Total</th>
              <th className="num">Share</th>
              <th className="num">{estimated ? "Est. value" : "Cost"}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={`${m.harness}-${m.modelName}`}>
                <td>
                  <code className="model-name">{m.modelName}</code>
                  {m.missingPricing && (
                    <span className="tag" title="Not in ccusage's price table. Token Larper estimates its value.">
                      Unpriced
                    </span>
                  )}
                </td>
                <td><ToolTag id={m.harness} /></td>
                <td className="bar-col"><ShareBar value={m.totalTokens} max={max} color={seriesOf(m.harness).color} /></td>
                <td className="num">{formatCompactNumber(m.inputTokens)}</td>
                <td className="num">{formatCompactNumber(m.outputTokens)}</td>
                <td className="num">{formatCompactNumber(m.cacheReadTokens)}</td>
                <td className="num">{formatCompactNumber(m.cacheCreationTokens)}</td>
                <td className="num strong">{formatCompactNumber(m.totalTokens)}</td>
                <td className="num muted">{pct(m.totalTokens, total)}</td>
                <td className="num">{formatCurrency(costOf(m))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {models.length === 0 && <p className="muted table-empty">No models match.</p>}
      </div>
    </section>
  );
}
