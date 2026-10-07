import React, { useMemo, useState } from "react";
import type { HarnessId, ThroughputRow } from "../../types.ts";
import { LineChart, seriesColor, SERIES_SLOTS, type LineSeries } from "../charts.tsx";
import { EmptyState, useDashboard } from "../context.tsx";
import type { Bucket } from "../lib/aggregate.ts";
import { daysInRange, parseDay } from "../lib/range.ts";
import { defaultSpeedBucket, metricValue, speedTrend, type SpeedMetric, type SpeedPeriod } from "../lib/speedTrend.ts";
import { FEW_RESPONSES, formatRate, modelKey } from "../lib/throughput.ts";
import { Segmented } from "../views/Overview.tsx";

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

const METRICS: { id: SpeedMetric; label: string }[] = [
  { id: "average", label: "Average" },
  { id: "median", label: "Median" },
];

type Display = "chart" | "table";
const DISPLAYS: { id: Display; label: string }[] = [
  { id: "chart", label: "Chart" },
  { id: "table", label: "Table" },
];

const NOUN: Record<Bucket, string> = { daily: "day", weekly: "week", monthly: "month" };

function periodLabels(p: SpeedPeriod, bucket: Bucket): { full: string; short: string } {
  if (bucket === "daily") {
    const d = parseDay(p.key);
    return {
      full: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
      short: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  }
  if (bucket === "weekly") return { full: p.label, short: p.key.slice(5) };
  return { full: p.label, short: p.label };
}

interface Series extends LineSeries {
  responses: number[];
}

/** Output speed per day, week or month, one line per tool or per model, to compare them over time. */
export function SpeedTrend({ group }: { group: "tool" | "model" }) {
  const { throughput, range, harness, seriesOf, nameOf } = useDashboard();
  const [chosenBucket, setBucket] = useState<Bucket | null>(null);
  const [metric, setMetric] = useState<SpeedMetric>("average");
  const [display, setDisplay] = useState<Display>("chart");
  const bucket = chosenBucket ?? defaultSpeedBucket(daysInRange(range.start, range.end));

  const trend = useMemo(() => {
    if (!throughput) return null;
    const keyOf = (r: ThroughputRow) => (group === "tool" ? r.harness : modelKey(r.harness, r.model));
    return speedTrend(throughput.rows, bucket, range.start, range.end, keyOf);
  }, [throughput, bucket, range.start, range.end, group]);

  const { series, hidden } = useMemo(() => {
    if (!trend || !throughput) return { series: [] as Series[], hidden: 0 };
    const responsesIn = (key: string) => trend.bySeries.get(key)!.reduce((acc, s) => acc + (s?.responses ?? 0), 0);
    let keys = [...trend.bySeries.keys()].sort((a, b) => responsesIn(b) - responsesIn(a));
    let hidden = 0;
    if (group === "model" && keys.length > SERIES_SLOTS) {
      hidden = keys.length - SERIES_SLOTS;
      keys = keys.slice(0, SERIES_SLOTS);
    }
    // Models take colors in order of all-time use, so the same set keeps its colors as the range moves.
    const order = (key: string) => {
      const i = throughput.modelOrder.indexOf(key);
      return i < 0 ? Infinity : i;
    };
    const colorOrder = [...keys].sort((a, b) => order(a) - order(b));
    const series = keys.map((key): Series => {
      const cells = trend.bySeries.get(key)!;
      const [h, model] = key.split("::") as [HarnessId, string | undefined];
      const name = group === "tool" ? nameOf(h) : harness === "all" ? `${model} · ${nameOf(h)}` : model!;
      return {
        key,
        name,
        color: group === "tool" ? seriesOf(h).color : seriesColor(colorOrder.indexOf(key)),
        values: cells.map((s) => (s ? metricValue(s, metric) : null)),
        dim: cells.map((s) => !!s && s.responses < FEW_RESPONSES),
        responses: cells.map((s) => s?.responses ?? 0),
      };
    });
    return { series, hidden };
  }, [trend, throughput, metric, group, harness, seriesOf, nameOf]);

  const labels = trend?.periods.map((p) => periodLabels(p, bucket)) ?? [];
  const what = group === "tool" ? "tool" : "model";
  const measure = metric === "average" ? "all output tokens over all response time" : "the middle response's speed";

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Speed over time</h2>
          <p>
            Approximate output tokens per second for each {what}, per {NOUN[bucket]} ({measure}). It includes the wait for the
            first token. Values from fewer than {FEW_RESPONSES} responses are dimmed in the tooltip and table.
            {hidden > 0 &&
              ` Showing the ${SERIES_SLOTS} models with the most responses; ${hidden} more ${hidden === 1 ? "is" : "are"} left out. Pick a tool to compare its models.`}
          </p>
        </div>
        <div className="panel-controls">
          <Segmented label="Group by" value={bucket} options={BUCKETS} onChange={setBucket} />
          <Segmented label="Speed measure" value={metric} options={METRICS} onChange={setMetric} />
          <Segmented label="Show as" value={display} options={DISPLAYS} onChange={setDisplay} />
        </div>
      </header>

      {!throughput ? (
        <EmptyState><p className="muted">Speeds appear once the first read of the session files finishes.</p></EmptyState>
      ) : series.length === 0 ? (
        <EmptyState><p className="muted">No timed responses in this range.</p></EmptyState>
      ) : display === "chart" ? (
        <>
          <LineChart
            labels={labels.map((l) => l.full)}
            shortLabels={labels.map((l) => l.short)}
            series={series}
            formatValue={(v) => `≈${formatRate(v)} tok/s`}
            dimNote={`Dimmed: fewer than ${FEW_RESPONSES} responses.`}
            ariaLabel={`Output speed by ${what} per ${NOUN[bucket]}`}
          />
          <div className="legend">
            {series.map((s) => (
              <span key={s.key} className="legend-item">
                <i style={{ background: s.color }} aria-hidden="true" /> {s.name}
              </span>
            ))}
          </div>
        </>
      ) : (
        <SpeedTable series={series} periods={labels.map((l) => l.full)} />
      )}
    </section>
  );
}

function SpeedTable({ series, periods }: { series: Series[]; periods: string[] }) {
  // Newest first, skipping periods where nothing was timed.
  const rows = periods
    .map((label, i) => ({ label, i }))
    .filter(({ i }) => series.some((s) => s.values[i] !== null))
    .reverse();
  return (
    <div className="table-scroll">
      <table className="table table-compact">
        <thead>
          <tr>
            <th>Period</th>
            {series.map((s) => (
              <th key={s.key} className="num">
                <span className="tool-tag speed-head">
                  <i style={{ background: s.color }} aria-hidden="true" />
                  {s.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, i }) => (
            <tr key={label}>
              <td className="nowrap">{label}</td>
              {series.map((s) => {
                const v = s.values[i];
                const n = s.responses[i]!;
                if (v === null || v === undefined) return <td key={s.key} className="num muted">—</td>;
                return (
                  <td
                    key={s.key}
                    className={s.dim?.[i] ? "num muted" : "num"}
                    title={`${n.toLocaleString("en-US")} ${n === 1 ? "response" : "responses"}`}
                  >
                    ≈{formatRate(v)} tok/s
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
