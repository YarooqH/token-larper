import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "../components/Icons.tsx";
import type { TimePeriodRow } from "../../types.ts";
import { ActivityCalendar, TOKEN_TYPE_SERIES, UsageBarChart, formatPeriodLabel, type ChartMode } from "../charts.tsx";
import { ShareBar, ToolTag, pct, useDashboard } from "../context.tsx";
import { KpiCards } from "../components/KpiCards.tsx";
import { bucketize, daysInRange, harnessTotals, summarize, type Bucket } from "../lib/aggregate.ts";
import { formatCompactNumber, formatCurrency } from "../utils.ts";

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

const MODES: { id: ChartMode; label: string }[] = [
  { id: "tokens-by-harness", label: "Tokens by tool" },
  { id: "cost-by-harness", label: "Cost" },
  { id: "token-types", label: "Token mix" },
];

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Overview({ bucket, setBucket }: { bucket: Bucket; setBucket: (b: Bucket) => void }) {
  const { data, days, range, harness, setHarness, costOf, estimated, series, seriesOf } = useDashboard();
  const [mode, setMode] = useState<ChartMode>("tokens-by-harness");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const rows = useMemo(() => bucketize(days, bucket, range.start, range.end), [days, bucket, range.start, range.end]);
  const activeRows = useMemo(() => rows.filter((r) => r.totalTokens > 0), [rows]);
  const totals = useMemo(() => summarize(days), [days]);
  const tools = useMemo(() => harnessTotals(days), [days]);
  // The calendar keeps its own 26-week window and shades the selected range inside it.
  const calendarDays = useMemo(() => daysInRange(data.daily, harness, "0000-00-00", "9999-99-99"), [data.daily, harness]);

  const legend = useMemo(() => {
    if (mode === "token-types") return TOKEN_TYPE_SERIES;
    const present = new Set(tools.map((t) => seriesOf(t.harness).key));
    return series.filter((s) => present.has(s.key));
  }, [mode, tools, series, seriesOf]);

  function openPeriod(row: TimePeriodRow) {
    if (row.totalTokens <= 0) return;
    setExpanded((prev) => ({ ...prev, [row.period]: true }));
    requestAnimationFrame(() =>
      document.getElementById(`period-${row.period}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    );
  }

  const toggle = (period: string) => setExpanded((prev) => ({ ...prev, [period]: !prev[period] }));
  const maxTool = tools[0]?.totalTokens ?? 0;
  const mix = [
    { ...TOKEN_TYPE_SERIES[0]!, value: totals.cacheReadTokens },
    { ...TOKEN_TYPE_SERIES[1]!, value: totals.inputTokens },
    { ...TOKEN_TYPE_SERIES[2]!, value: totals.outputTokens },
    { ...TOKEN_TYPE_SERIES[3]!, value: totals.cacheCreationTokens },
  ];
  const bucketNoun = { daily: "days", weekly: "weeks", monthly: "months" }[bucket];

  return (
    <>
      <KpiCards />

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Usage over time</h2>
            <p>
              {rows.length} {bucketNoun}, {activeRows.length} with usage. Hover for a breakdown, click a bar to see its models.
            </p>
          </div>
          <div className="panel-controls">
            <Segmented label="Group by" value={bucket} options={BUCKETS} onChange={setBucket} />
            <Segmented label="Chart shows" value={mode} options={MODES} onChange={setMode} />
          </div>
        </header>
        <UsageBarChart
          rows={rows}
          mode={mode}
          granularity={bucket}
          costOf={costOf}
          series={series}
          seriesOf={seriesOf}
          onSelect={openPeriod}
        />
        <div className="legend">
          {legend.map((s) => (
            <span key={s.key} className="legend-item">
              <i style={{ background: s.color }} aria-hidden="true" /> {s.name}
            </span>
          ))}
        </div>
      </section>

      <div className="split overview-split">
        <section className="panel">
          <header className="panel-head">
            <div>
              <h2>Usage by tool</h2>
              <p>{harness === "all" ? "Select a tool to filter the whole dashboard." : "Select again to show all tools."}</p>
            </div>
          </header>
          {tools.length === 0 ? (
            <p className="muted">No usage in this range.</p>
          ) : (
            <div className="table-scroll">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th className="bar-col"><span className="sr-only">Share</span></th>
                    <th className="num">Tokens</th>
                    <th className="num">Share</th>
                    <th className="num">{estimated ? "Est. value" : "Cost"}</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((t) => (
                    <tr
                      key={t.harness}
                      className={`row-button ${harness === t.harness ? "is-selected" : ""}`}
                      onClick={() => setHarness(harness === t.harness ? "all" : t.harness)}
                    >
                      <td>
                        {/* The row handles the click; the button gives it a keyboard and screen-reader target. */}
                        <button type="button" className="cell-button" aria-pressed={harness === t.harness}>
                          <ToolTag id={t.harness} />
                        </button>
                        <span className="cell-note">{t.models[0]?.modelName ?? ""}</span>
                      </td>
                      <td className="bar-col"><ShareBar value={t.totalTokens} max={maxTool} color={seriesOf(t.harness).color} /></td>
                      <td className="num">{formatCompactNumber(t.totalTokens)}</td>
                      <td className="num muted">{pct(t.totalTokens, totals.totalTokens)}</td>
                      <td className="num">{formatCurrency(costOf(t))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <h2>Token mix</h2>
              <p>Where the {formatCompactNumber(totals.totalTokens)} tokens in this range went.</p>
            </div>
          </header>
          <div className="mix-bar" aria-hidden="true">
            {mix.filter((m) => m.value > 0).map((m) => (
              <span key={m.key} style={{ flexGrow: m.value, background: m.color }} />
            ))}
          </div>
          <dl className="mix-list">
            {mix.map((m) => (
              <div key={m.key}>
                <dt><i style={{ background: m.color }} aria-hidden="true" />{m.name}</dt>
                <dd>
                  <strong>{formatCompactNumber(m.value)}</strong>
                  <span>{pct(m.value, totals.totalTokens)}</span>
                </dd>
              </div>
            ))}
            <div>
              <dt><i className="swatch-none" aria-hidden="true" />Reasoning (within output)</dt>
              <dd><strong>{formatCompactNumber(totals.reasoningOutputTokens)}</strong><span /></dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="panel" aria-labelledby="daily-activity-heading">
        <header className="panel-head">
          <div>
            <h2 id="daily-activity-heading">Daily activity</h2>
          </div>
        </header>
        <ActivityCalendar days={calendarDays} costOf={costOf} rangeStart={range.start} rangeEnd={range.end} />
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Period details</h2>
            <p>{activeRows.length} {bucketNoun} with usage. Expand a row for its tools and models.</p>
          </div>
        </header>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Tools</th>
                <th className="num">Input</th>
                <th className="num">Output</th>
                <th className="num">Cache read</th>
                <th className="num">Cache write</th>
                <th className="num">Total</th>
                <th className="num">{estimated ? "Est. value" : "Cost"}</th>
              </tr>
            </thead>
            <tbody>
              {[...activeRows].reverse().map((row) => {
                const open = Boolean(expanded[row.period]);
                const entries = Object.values(row.byHarness).sort((a, b) => b.totalTokens - a.totalTokens);
                return (
                  <React.Fragment key={row.period}>
                    <tr
                      id={`period-${row.period}`}
                      className={`row-button ${open ? "is-open" : ""}`}
                      onClick={() => toggle(row.period)}
                    >
                      <td className="nowrap">
                        <button type="button" className="cell-button" aria-expanded={open}>
                          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                          <strong>{formatPeriodLabel(row, bucket)}</strong>
                        </button>
                      </td>
                      <td>
                        <div className="tag-row">{entries.map((hb) => <ToolTag key={hb.harness} id={hb.harness} />)}</div>
                      </td>
                      <td className="num">{formatCompactNumber(row.inputTokens)}</td>
                      <td className="num">{formatCompactNumber(row.outputTokens)}</td>
                      <td className="num">{formatCompactNumber(row.cacheReadTokens)}</td>
                      <td className="num">{formatCompactNumber(row.cacheCreationTokens)}</td>
                      <td className="num strong">{formatCompactNumber(row.totalTokens)}</td>
                      <td className="num strong">{formatCurrency(costOf(row))}</td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={8}>
                          <div className="detail-grid">
                            {entries.map((hb) => (
                              <div key={hb.harness} className="detail-card">
                                <div className="detail-head">
                                  <ToolTag id={hb.harness} />
                                  <span>{formatCompactNumber(hb.totalTokens)} tokens</span>
                                  <span>{formatCurrency(costOf(hb))}</span>
                                </div>
                                <ul>
                                  {[...hb.models].sort((a, b) => b.totalTokens - a.totalTokens).map((m) => (
                                    <li key={m.modelName}>
                                      <code>{m.modelName}</code>
                                      <span>{formatCompactNumber(m.totalTokens)}</span>
                                      <span>{formatCurrency(costOf(m))}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
