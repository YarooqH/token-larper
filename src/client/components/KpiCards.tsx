import React, { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useDashboard } from "../context.tsx";
import { daysInRange, sparkline, summarize, type RangeTotals } from "../lib/aggregate.ts";
import { daysInRange as spanDays, formatDay, previousRange } from "../lib/range.ts";
import { formatCompactNumber, formatCurrency, formatExactNumber } from "../utils.ts";

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || values.every((v) => v === 0)) return <div className="spark spark-empty" aria-hidden="true" />;
  const max = Math.max(...values);
  const w = 100;
  const h = 28;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (max > 0 ? (v / max) * (h - 4) : 0)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${w},${h} L0,${h} Z`} className="spark-area" />
      <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.2" className="spark-dot" />
    </svg>
  );
}

type DeltaUnit = "percent" | "points" | "days";

function Delta({ current, previous, unit, days }: { current: number; previous: number | null; unit: DeltaUnit; days: number }) {
  if (previous === null) return <span className="kpi-delta">All recorded usage</span>;
  const vs = `vs previous ${days} ${days === 1 ? "day" : "days"}`;
  if (unit === "percent" && previous === 0) {
    return <span className="kpi-delta">{current > 0 ? `No usage in the previous ${days} days` : `None ${vs}`}</span>;
  }
  const diff = unit === "percent" ? ((current - previous) / previous) * 100 : current - previous;
  const flat = Math.abs(diff) < (unit === "days" ? 0.5 : 0.05);
  const Icon = flat ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  const amount =
    unit === "percent"
      ? `${Math.abs(diff) >= 100 ? Math.round(Math.abs(diff)).toLocaleString("en-US") : Math.abs(diff).toFixed(1)}%`
      : unit === "points"
        ? `${Math.abs(diff).toFixed(1)} pts`
        : `${Math.round(Math.abs(diff))} ${Math.round(Math.abs(diff)) === 1 ? "day" : "days"}`;
  return (
    <span className="kpi-delta">
      <Icon size={13} aria-hidden="true" />
      {!flat && <span className="sr-only">{diff > 0 ? "Up" : "Down"}</span>}
      {flat ? "No change" : amount} {vs}
    </span>
  );
}

export function KpiCards() {
  const { data, days, range, harness, costOf, estimated, openModelPrices } = useDashboard();
  const prev = previousRange(range);
  const current = useMemo(() => summarize(days), [days]);
  const previous: RangeTotals | null = useMemo(
    () => (prev ? summarize(daysInRange(data.daily, harness, prev.start, prev.end)) : null),
    [data.daily, harness, prev?.start, prev?.end]
  );
  const rangeDays = spanDays(range.start, range.end);
  const prevDays = prev?.days ?? 0;
  const spark = (pick: Parameters<typeof sparkline>[3]) => sparkline(days, range.start, range.end, pick);

  const cost = costOf(current);
  const unpriced = Math.max(0, current.estimatedCost - current.verifiedCost);

  return (
    <section className="kpi-grid" aria-label="Summary for the selected range">
      <article className="kpi">
        <h3 className="kpi-label">Tokens</h3>
        <div className="kpi-value">{formatCompactNumber(current.totalTokens)}</div>
        <p className="kpi-sub">{formatExactNumber(current.totalTokens)} tokens</p>
        <Delta current={current.totalTokens} previous={previous?.totalTokens ?? null} unit="percent" days={prevDays} />
        <Sparkline values={spark((d) => d.totalTokens)} />
      </article>

      <article className="kpi">
        <h3 className="kpi-label">{estimated ? "Estimated API value" : "Verified cost"}</h3>
        <div className="kpi-value">{formatCurrency(cost)}</div>
        <p className="kpi-sub">
          {estimated
            ? `${formatCurrency(current.verifiedCost)} verified + ${formatCurrency(unpriced)} estimated`
            : `${formatCurrency(current.estimatedCost)} estimated API value`}
        </p>
        <Delta current={cost} previous={previous ? costOf(previous) : null} unit="percent" days={prevDays} />
        {estimated && (
          <button type="button" className="kpi-link" onClick={openModelPrices}>How this is estimated</button>
        )}
        <Sparkline values={spark((d) => costOf(d))} />
      </article>

      <article className="kpi">
        <h3 className="kpi-label">Active days</h3>
        <div className="kpi-value">
          {current.activeDays}
          <span className="kpi-of"> / {rangeDays}</span>
        </div>
        <p className="kpi-sub">
          {current.busiestDay
            ? `Busiest: ${formatDay(current.busiestDay.period)} · ${formatCompactNumber(current.busiestDay.totalTokens)}`
            : "No recorded usage"}
        </p>
        <Delta current={current.activeDays} previous={previous?.activeDays ?? null} unit="days" days={prevDays} />
        <Sparkline values={spark((d) => (d.totalTokens > 0 ? 1 : 0))} />
      </article>

      <article className="kpi">
        <h3 className="kpi-label">Cache read rate</h3>
        <div className="kpi-value">{current.cacheHitRate.toFixed(1)}%</div>
        <p className="kpi-sub">
          {current.activeDays > 0
            ? `${formatCurrency(cost / current.activeDays)} per active day · ${formatCompactNumber(current.cacheReadTokens)} cached`
            : `${formatCompactNumber(current.cacheReadTokens)} cached tokens`}
        </p>
        {previous && previous.activeDays === 0 ? (
          <span className="kpi-delta">No usage in the previous {prevDays} days</span>
        ) : (
          <Delta current={current.cacheHitRate} previous={previous?.cacheHitRate ?? null} unit="points" days={prevDays} />
        )}
        <div className="kpi-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(current.cacheHitRate)} aria-label="Cache read rate">
          <span style={{ width: `${Math.min(100, current.cacheHitRate)}%` }} />
        </div>
      </article>
    </section>
  );
}
