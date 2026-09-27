import type {
  HarnessId,
  ModelMetric,
  PeriodHarnessBreakdown,
  SessionEntry,
  TimePeriodRow,
} from "../../types.ts";
import { isoWeek } from "../utils.ts";
import { eachDay, parseDay } from "./range.ts";

// Everything the dashboard shows is derived here from the server's daily rows and session
// list, so a date range or tool filter narrows every number on the page the same way.

export type HarnessFilter = HarnessId | "all";
export type Bucket = "daily" | "weekly" | "monthly";

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  verifiedCost: number;
  estimatedCost: number;
}

const COUNT_KEYS: (keyof TokenCounts)[] = [
  "inputTokens",
  "outputTokens",
  "cacheCreationTokens",
  "cacheReadTokens",
  "reasoningOutputTokens",
  "totalTokens",
  "verifiedCost",
  "estimatedCost",
];

export function zeroCounts(): TokenCounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    verifiedCost: 0,
    estimatedCost: 0,
  };
}

export function addCounts<T extends TokenCounts>(target: T, source: TokenCounts): T {
  for (const key of COUNT_KEYS) target[key] += source[key];
  return target;
}

/** Share of prompt-side tokens served from cache. */
export function cacheReadRate(c: TokenCounts): number {
  const prompt = c.inputTokens + c.cacheReadTokens + c.cacheCreationTokens;
  return prompt > 0 ? (c.cacheReadTokens / prompt) * 100 : 0;
}

export function emptyPeriod(period: string, label = period): TimePeriodRow {
  return { period, label, ...zeroCounts(), byHarness: {}, modelsUsed: [] };
}

function mergeModels(into: ModelMetric[], from: ModelMetric[]): void {
  for (const m of from) {
    const existing = into.find((x) => x.modelName === m.modelName);
    if (existing) {
      addCounts(existing, m);
      existing.missingPricing ||= m.missingPricing;
    } else into.push({ ...m });
  }
}

function mergeRow(target: TimePeriodRow, source: TimePeriodRow): void {
  addCounts(target, source);
  for (const [id, hb] of Object.entries(source.byHarness)) {
    const existing = target.byHarness[id];
    if (existing) {
      addCounts(existing, hb);
      mergeModels(existing.models, hb.models);
    } else {
      target.byHarness[id] = { ...hb, models: hb.models.map((m) => ({ ...m })) };
    }
  }
  for (const m of source.modelsUsed) if (!target.modelsUsed.includes(m)) target.modelsUsed.push(m);
}

/** Narrow one day to one harness (or keep it whole for "all"). */
function projectDay(row: TimePeriodRow, harness: HarnessFilter): TimePeriodRow | null {
  if (harness === "all") return row;
  const hb = row.byHarness[harness];
  if (!hb) return null;
  const { harness: _id, models, ...counts } = hb;
  return {
    period: row.period,
    label: row.label,
    ...counts,
    byHarness: { [harness]: hb },
    modelsUsed: models.map((m) => m.modelName),
  };
}

/** Days with usage inside [start, end] for the selected harness, oldest first. */
export function daysInRange(daily: TimePeriodRow[], harness: HarnessFilter, start: string, end: string): TimePeriodRow[] {
  const out: TimePeriodRow[] = [];
  for (const row of daily) {
    if (row.period < start || row.period > end) continue;
    const projected = projectDay(row, harness);
    if (projected && projected.totalTokens > 0) out.push(projected);
  }
  return out;
}

export interface RangeTotals extends TokenCounts {
  activeDays: number;
  cacheHitRate: number;
  busiestDay: TimePeriodRow | null;
}

export function summarize(days: TimePeriodRow[]): RangeTotals {
  const totals = zeroCounts();
  let busiest: TimePeriodRow | null = null;
  for (const d of days) {
    addCounts(totals, d);
    if (!busiest || d.totalTokens > busiest.totalTokens) busiest = d;
  }
  return { ...totals, activeDays: days.length, cacheHitRate: cacheReadRate(totals), busiestDay: busiest };
}

function bucketKey(day: string, bucket: Bucket): { key: string; label: string } {
  if (bucket === "daily") return { key: day, label: day };
  if (bucket === "monthly") {
    const d = parseDay(day);
    return { key: day.slice(0, 7), label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) };
  }
  const d = parseDay(day);
  return isoWeek(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Every bucket in the range, idle ones included, so a gap in usage shows as a gap.
 * Weeks and months at the edges are clipped to the range rather than padded out.
 */
export function bucketize(days: TimePeriodRow[], bucket: Bucket, start: string, end: string): TimePeriodRow[] {
  const buckets = new Map<string, TimePeriodRow>();
  for (const day of eachDay(start, end)) {
    const { key, label } = bucketKey(day, bucket);
    if (!buckets.has(key)) buckets.set(key, emptyPeriod(key, label));
  }
  for (const d of days) {
    const target = buckets.get(bucketKey(d.period, bucket).key);
    if (target) mergeRow(target, d);
  }
  return [...buckets.values()];
}

export interface HarnessRangeSummary extends TokenCounts {
  harness: HarnessId;
  activeDays: number;
  cacheHitRate: number;
  lastActive: string | null;
  models: ModelMetric[];
}

export function harnessTotals(days: TimePeriodRow[]): HarnessRangeSummary[] {
  const map = new Map<HarnessId, HarnessRangeSummary>();
  for (const d of days) {
    for (const hb of Object.values(d.byHarness) as PeriodHarnessBreakdown[]) {
      let entry = map.get(hb.harness);
      if (!entry) {
        entry = { harness: hb.harness, ...zeroCounts(), activeDays: 0, cacheHitRate: 0, lastActive: null, models: [] };
        map.set(hb.harness, entry);
      }
      addCounts(entry, hb);
      mergeModels(entry.models, hb.models);
      entry.activeDays += 1;
      if (!entry.lastActive || d.period > entry.lastActive) entry.lastActive = d.period;
    }
  }
  const list = [...map.values()];
  for (const h of list) {
    h.cacheHitRate = cacheReadRate(h);
    h.models.sort((a, b) => b.totalTokens - a.totalTokens);
  }
  return list.sort((a, b) => b.totalTokens - a.totalTokens);
}

export function modelTotals(days: TimePeriodRow[]): ModelMetric[] {
  const map = new Map<string, ModelMetric>();
  for (const d of days) {
    for (const hb of Object.values(d.byHarness)) {
      for (const m of hb.models) {
        const key = `${m.harness}::${m.modelName}`;
        const existing = map.get(key);
        if (existing) {
          addCounts(existing, m);
          existing.missingPricing ||= m.missingPricing;
        } else map.set(key, { ...m });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Sessions count toward the day they last had activity. */
export function sessionsInRange(sessions: SessionEntry[], harness: HarnessFilter, start: string, end: string): SessionEntry[] {
  return sessions.filter(
    (s) => (harness === "all" || s.harness === harness) && s.date >= start && s.date <= end
  );
}

export interface ProjectSummary extends TokenCounts {
  key: string;
  name: string;
  root: string | null;
  harnesses: HarnessId[];
  sessions: SessionEntry[];
  lastActivity: string;
}

export function groupProjects(sessions: SessionEntry[]): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>();
  for (const s of sessions) {
    const key = s.projectRoot ?? `unattributed:${s.harness}`;
    let p = map.get(key);
    if (!p) {
      p = {
        key,
        name: s.projectName ?? "No project recorded",
        root: s.projectRoot ?? null,
        harnesses: [],
        sessions: [],
        lastActivity: "",
        ...zeroCounts(),
      };
      map.set(key, p);
    }
    addCounts(p, s);
    p.sessions.push(s);
    if (!p.harnesses.includes(s.harness)) p.harnesses.push(s.harness);
    const when = s.lastActivity ?? s.date;
    if (when > p.lastActivity) p.lastActivity = when;
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

/**
 * A fixed number of evenly sized buckets across the range for a stat-tile sparkline;
 * long ranges are summed into wider buckets instead of drawing hundreds of points.
 */
export function sparkline(days: TimePeriodRow[], start: string, end: string, pick: (d: TokenCounts) => number, points = 24): number[] {
  const all = eachDay(start, end);
  const n = Math.min(points, all.length);
  if (n <= 1) return [];
  const byDay = new Map(days.map((d) => [d.period, d]));
  const values = new Array<number>(n).fill(0);
  all.forEach((day, i) => {
    const d = byDay.get(day);
    if (d) values[Math.min(n - 1, Math.floor((i * n) / all.length))]! += pick(d);
  });
  return values;
}

