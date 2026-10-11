import type { ThroughputRow } from "../../types.ts";
import { summarizeSpeed, type SpeedSummary } from "../../throughput/stats.ts";
import { bucketKey, type Bucket } from "./aggregate.ts";
import { eachDay } from "./range.ts";

// Speed per day, week or month for each tool or model, so their tok/s can be compared over
// time. Rows are merged per period before summarizing, so a week's median comes from every
// response in it, not from an average of daily medians.

export type SpeedMetric = "average" | "median";

export interface SpeedPeriod {
  key: string;
  label: string;
}

export interface SpeedTrend {
  /** Every period in the range, idle ones included, so a gap shows as a gap. */
  periods: SpeedPeriod[];
  /** One entry per period for each series key; null where it had no timed responses. */
  bySeries: Map<string, (SpeedSummary | null)[]>;
}

export function speedTrend(
  rows: ThroughputRow[],
  bucket: Bucket,
  start: string,
  end: string,
  seriesOf: (row: ThroughputRow) => string,
): SpeedTrend {
  const index = new Map<string, number>();
  const periods: SpeedPeriod[] = [];
  for (const day of eachDay(start, end)) {
    const { key, label } = bucketKey(day, bucket);
    if (index.has(key)) continue;
    index.set(key, periods.length);
    periods.push({ key, label });
  }

  const grouped = new Map<string, ThroughputRow[][]>();
  for (const r of rows) {
    const i = index.get(bucketKey(r.day, bucket).key);
    if (i === undefined) continue;
    const key = seriesOf(r);
    let cells = grouped.get(key);
    if (!cells) {
      cells = periods.map(() => []);
      grouped.set(key, cells);
    }
    cells[i]!.push(r);
  }

  const bySeries = new Map<string, (SpeedSummary | null)[]>();
  for (const [key, cells] of grouped) bySeries.set(key, cells.map((list) => (list.length ? summarizeSpeed(list) : null)));
  return { periods, bySeries };
}

export const metricValue = (s: SpeedSummary, metric: SpeedMetric) => (metric === "median" ? s.median : s.tokensPerSecond);

/** Daily for a month or so, weekly beyond that, so a line has enough points without crowding. */
export function defaultSpeedBucket(days: number): Bucket {
  return days <= 45 ? "daily" : days <= 400 ? "weekly" : "monthly";
}
