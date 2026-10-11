import React, { useEffect, useMemo, useRef, useState } from "react";
import type { HarnessId, TimePeriodRow } from "../types.ts";
import { formatCompactNumber, formatCurrency } from "./utils.ts";

export type ChartMode = "tokens-by-harness" | "cost-by-harness" | "token-types";
export type Granularity = "daily" | "weekly" | "monthly" | "yearly";

// Seven validated categorical slots (CVD-checked in this adjacency order, light and dark);
// everything past slot 7 folds into one neutral "Other" series.
export const SERIES_SLOTS = 7;
export const OTHER_SERIES = "var(--series-other)";

export function seriesColor(slot: number): string {
  return slot < SERIES_SLOTS ? `var(--series-${slot + 1})` : OTHER_SERIES;
}

export interface SeriesInfo {
  key: string;
  name: string;
  color: string;
}

type Cost = (item: { verifiedCost: number; estimatedCost: number }) => number;

const TOKEN_TYPES: { key: string; name: string; pick: (r: TimePeriodRow) => number }[] = [
  { key: "cacheRead", name: "Cache read", pick: (r) => r.cacheReadTokens },
  { key: "input", name: "Input", pick: (r) => r.inputTokens },
  { key: "output", name: "Output", pick: (r) => r.outputTokens },
  { key: "cacheWrite", name: "Cache write", pick: (r) => r.cacheCreationTokens },
];

export const TOKEN_TYPE_SERIES: SeriesInfo[] = TOKEN_TYPES.map((t, i) => ({
  key: t.key,
  name: t.name,
  color: seriesColor(i),
}));

/** Round an axis maximum up to 1/2/2.5/5 × 10^n so ticks land on clean numbers. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

function formatAxis(value: number, isCost: boolean): string {
  if (isCost) {
    if (value >= 1000) return `$${formatCompactNumber(value)}`;
    return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(value < 1 ? 2 : 1)}`;
  }
  if (value === 0) return "0";
  return formatCompactNumber(value).replace(/\.0+([KMB])$/, "$1").replace(/(\.\d*?)0+([KMB])$/, "$1$2");
}

export function formatPeriodLabel(row: TimePeriodRow, granularity: Granularity, short = false): string {
  if (granularity === "daily") {
    const d = new Date(`${row.period}T00:00:00`);
    return d.toLocaleDateString("en-US", short
      ? { month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  if (granularity === "weekly") return short ? row.period.slice(5) : row.label;
  return row.label;
}

interface UsageBarChartProps {
  rows: TimePeriodRow[];
  mode: ChartMode;
  granularity: Granularity;
  costOf: Cost;
  series: SeriesInfo[];
  seriesOf: (harness: HarnessId) => SeriesInfo;
  /** Clicking or pressing Enter on a bar; without it the bars only show their tooltip. */
  onSelect?: (row: TimePeriodRow) => void;
  /** Labels bars that aren't dates, such as the Live tab's minutes. */
  formatLabel?: (row: TimePeriodRow, short: boolean) => string;
}

export function UsageBarChart({ rows, mode, granularity, costOf, series, seriesOf, onSelect, formatLabel }: UsageBarChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(800);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setPlotWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [rows.length === 0]);
  const isCost = mode === "cost-by-harness";

  const stacks = useMemo(
    () =>
      rows.map((row) => {
        const values = new Map<string, number>();
        if (mode === "token-types") {
          for (const t of TOKEN_TYPES) values.set(t.key, t.pick(row));
        } else {
          for (const hb of Object.values(row.byHarness)) {
            const key = seriesOf(hb.harness).key;
            values.set(key, (values.get(key) ?? 0) + (isCost ? costOf(hb) : hb.totalTokens));
          }
        }
        const total = isCost ? costOf(row) : row.totalTokens;
        return { row, total, values };
      }),
    [rows, mode, isCost, costOf, seriesOf]
  );

  const ticks = niceTicks(Math.max(0, ...stacks.map((s) => s.total)));
  const yMax = ticks[ticks.length - 1] || 1;
  // Roughly one date label per 64px, so labels never collide on narrow screens.
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(plotWidth / 64))));
  const current = active !== null ? stacks[active] : undefined;
  const labelOf = (row: TimePeriodRow, short = false) => formatLabel?.(row, short) ?? formatPeriodLabel(row, granularity, short);

  function indexFromPointer(event: React.MouseEvent<HTMLDivElement>): number {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.floor(((event.clientX - box.left) / box.width) * rows.length);
    return Math.min(rows.length - 1, Math.max(0, i));
  }

  function handleKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!rows.length) return;
    const last = rows.length - 1;
    const i = active ?? last;
    let next = i;
    if (event.key === "ArrowLeft") next = Math.max(0, i - 1);
    else if (event.key === "ArrowRight") next = Math.min(last, i + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if ((event.key === "Enter" || event.key === " ") && active !== null && onSelect) {
      event.preventDefault();
      onSelect(rows[active]!);
      return;
    } else return;
    event.preventDefault();
    setActive(next);
  }

  if (rows.length === 0) {
    return <div className="uchart-empty">No usage recorded for this filter.</div>;
  }

  // The tooltip sits beside the active bar (never over it), flipping sides past the midpoint.
  const tipSide = active !== null && active >= rows.length / 2 ? "left" : "right";
  const tipSeries = current
    ? (mode === "token-types" ? TOKEN_TYPE_SERIES : series)
        .map((s) => ({ ...s, value: current.values.get(s.key) ?? 0 }))
        .filter((s) => s.value > 0)
        .sort((a, b) => b.value - a.value)
    : [];

  return (
    <div className="uchart">
      <div className="uchart-plot" ref={plotRef}>
        <div className="uchart-grid" aria-hidden="true">
          {ticks.map((t) => (
            <div key={t} className="uchart-gridline" style={{ bottom: `${(t / yMax) * 100}%` }}>
              <span>{formatAxis(t, isCost)}</span>
            </div>
          ))}
        </div>

        <div
          className="uchart-bars"
          role="group"
          tabIndex={0}
          aria-label={`Usage chart. Use left and right arrow keys to move between periods${onSelect ? ", Enter to open details" : ""}.`}
          onMouseMove={(e) => setActive(indexFromPointer(e))}
          onMouseLeave={() => setActive(null)}
          onClick={(e) => onSelect?.(rows[indexFromPointer(e)]!)}
          onKeyDown={handleKey}
          onBlur={() => setActive(null)}
        >
          {stacks.map((s, i) => {
            const segs = (mode === "token-types" ? TOKEN_TYPE_SERIES : series)
              .map((info) => ({ info, value: s.values.get(info.key) ?? 0 }))
              .filter((seg) => seg.value > 0);
            return (
              <div key={s.row.period} className={`uchart-col ${active === i ? "is-active" : ""}`}>
                {s.total > 0 && (
                  <div className="uchart-stack" style={{ height: `${Math.max(0.6, (s.total / yMax) * 100)}%` }}>
                    {segs.map((seg) => (
                      <div key={seg.info.key} className="uchart-seg" style={{ flexGrow: seg.value, background: seg.info.color }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {current && (
          <div
            className={`uchart-tip side-${tipSide}`}
            style={{ left: `calc(var(--axis-w) + (100% - var(--axis-w)) * ${(active! + 0.5) / rows.length})` }}
            role="status"
          >
            <div className="uchart-tip-head">
              <strong>{labelOf(current.row)}</strong>
              {current.total > 0 && (
                <span>{isCost ? formatCurrency(current.total) : `${formatCompactNumber(current.total)} tokens`}</span>
              )}
            </div>
            {current.total === 0 ? (
              <div className="uchart-tip-empty">No usage</div>
            ) : (
              <ul>
                {tipSeries.map((s) => (
                  <li key={s.key}>
                    <i style={{ background: s.color }} />
                    <span>{s.name}</span>
                    <b>{isCost ? formatCurrency(s.value) : formatCompactNumber(s.value)}</b>
                  </li>
                ))}
              </ul>
            )}
            {!isCost && current.total > 0 && (
              <div className="uchart-tip-foot">{formatCurrency(costOf(current.row))}{onSelect ? " · click for models" : ""}</div>
            )}
          </div>
        )}
      </div>

      <div className="uchart-xaxis" aria-hidden="true">
        {rows.map((row, i) => (
          <span key={row.period}>
            {i % labelEvery === (rows.length - 1) % labelEvery && <em>{labelOf(row, true)}</em>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ActivityCalendarProps {
  days: TimePeriodRow[];
  costOf: Cost;
  weeks?: number;
  /** Cells outside this span are shaded back so the selected date range stands out. */
  rangeStart?: string;
  rangeEnd?: string;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ActivityCalendar({ days, costOf, weeks, rangeStart, rangeEnd }: ActivityCalendarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleWeeks = weeks ?? (width ? Math.max(14, Math.min(52, Math.floor((width + 3) / 18))) : 26);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const { columns, months, levels, byDate, activeCount } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.period, d]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Columns are Monday-first weeks ending with the current week.
    const start = new Date(today);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (visibleWeeks - 1) * 7);

    const columns: { key: string; future: boolean }[][] = [];
    const months: { col: number; label: string }[] = [];
    const cursor = new Date(start);
    for (let w = 0; w < visibleWeeks; w++) {
      const col: { key: string; future: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        if (cursor.getDate() === 1 || (w === 0 && d === 0)) {
          months.push({ col: w, label: cursor.toLocaleDateString("en-US", { month: "short" }) });
        }
        col.push({ key: toDateKey(cursor), future: cursor > today });
        cursor.setDate(cursor.getDate() + 1);
      }
      columns.push(col);
    }

    // Quartiles of the visible active days, so one huge day doesn't wash out the rest.
    const visible = columns.flat().map((c) => byDate.get(c.key)?.totalTokens ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
    const q = (p: number) => visible[Math.min(visible.length - 1, Math.floor(p * visible.length))] ?? 0;
    const cuts = [q(0.25), q(0.5), q(0.75)];
    const levels = (v: number) => (v <= 0 ? 0 : v <= cuts[0]! ? 1 : v <= cuts[1]! ? 2 : v <= cuts[2]! ? 3 : 4);

    return { columns, months: months.filter((m, i, all) => i === 0 || m.col - all[i - 1]!.col >= 3), levels, byDate, activeCount: visible.length };
  }, [days, visibleWeeks]);

  const hoveredRow = hovered ? byDate.get(hovered) : undefined;
  const hoveredLabel = hovered
    ? new Date(`${hovered}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "";

  return (
    <div className="cal" ref={containerRef}>
      <div className="cal-months" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${visibleWeeks}, minmax(0, 1fr))` }}>
        {months.map((m) => (
          <span key={`${m.col}-${m.label}`} style={{ gridColumn: `${m.col + 1} / span 3` }}>{m.label}</span>
        ))}
      </div>
      <div
        className="cal-grid"
        role="img"
        aria-label={`Daily usage calendar for the last ${visibleWeeks} weeks: ${activeCount} active days.`}
        style={{ gridTemplateColumns: `repeat(${visibleWeeks}, minmax(0, 1fr))` }}
        onMouseLeave={() => setHovered(null)}
      >
        {columns.map((col, w) =>
          col.map((cell, d) => (
            <div
              key={cell.key}
              className={`cal-cell ${cell.future ? "is-future" : `lvl-${levels(byDate.get(cell.key)?.totalTokens ?? 0)}`} ${hovered === cell.key ? "is-hovered" : ""} ${rangeStart && rangeEnd && (cell.key < rangeStart || cell.key > rangeEnd) ? "is-outside" : ""}`}
              style={{ gridColumn: w + 1, gridRow: d + 1 }}
              onMouseEnter={() => !cell.future && setHovered(cell.key)}
            />
          ))
        )}
      </div>
      <div className="cal-foot">
        <span className="cal-readout">
          {hovered
            ? hoveredRow
              ? <><strong>{hoveredLabel}</strong> · {formatCompactNumber(hoveredRow.totalTokens)} tokens · {formatCurrency(costOf(hoveredRow))}</>
              : <><strong>{hoveredLabel}</strong> · No usage</>
            : `${activeCount} active days in the last ${visibleWeeks} weeks`}
        </span>
        <span className="cal-scale" aria-hidden="true">
          Less {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`cal-cell lvl-${l}`} />)} More
        </span>
      </div>
    </div>
  );
}
