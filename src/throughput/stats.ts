import type { ActivityRow, HarnessId, ThroughputRow } from "../types.ts";
import { localDateKey } from "../client/utils.ts";

// Shared by the server, which turns parsed responses into per-day rows, and the dashboard,
// which merges the rows for whatever range and tool are selected. Nothing here touches disk.

/** One model response: when the request went out, when the last token arrived, and how many it produced. */
export interface Sample {
  model: string;
  start: number;
  end: number;
  outputTokens: number;
}

export type Interval = [start: number, end: number];

/** Gaps between responses up to this long are tool calls or a quick reply, so they count as working time. */
export const IDLE_GAP_MS = 2 * 60_000;

// Short replies are mostly time to first token, and a response that runs for half an hour
// is a stalled stream, so neither says much about speed.
const MIN_TOKENS = 20;
const MIN_MS = 200;
const MAX_MS = 30 * 60_000;

// Rates are bucketed on a log scale, 10% per bin, so a range's median and p90 come from
// summing bins instead of keeping every response.
const BIN_GROWTH = Math.log(1.1);
const MAX_BIN = 100; // about 13,800 tok/s

export function rateBin(tokensPerSecond: number): number {
  if (!(tokensPerSecond > 1)) return 0;
  return Math.min(MAX_BIN, Math.floor(Math.log(tokensPerSecond) / BIN_GROWTH));
}

/** The geometric middle of a bin. */
export function binRate(bin: number): number {
  return Math.exp((bin + 0.5) * BIN_GROWTH);
}

export function countsForSpeed(s: Sample): boolean {
  const ms = s.end - s.start;
  return s.outputTokens >= MIN_TOKENS && ms >= MIN_MS && ms <= MAX_MS;
}

/** Sorted, merged working intervals: responses closer than IDLE_GAP_MS join into one. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([s, e]) => e >= s).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s - last[1] <= IDLE_GAP_MS) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function nextLocalMidnight(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** Working time per local day; an interval that crosses midnight is split between the two days. */
export function activityByDay(harness: HarnessId, merged: Interval[]): ActivityRow[] {
  const byDay = new Map<string, number>();
  for (const [s, e] of merged) {
    let t = s;
    while (t < e) {
      const cut = Math.min(e, nextLocalMidnight(t));
      const day = localDateKey(new Date(t));
      byDay.set(day, (byDay.get(day) ?? 0) + (cut - t));
      t = cut;
    }
  }
  return [...byDay].map(([day, activeMs]) => ({ day, harness, activeMs }));
}

/** Per-day, per-model speed rows for one tool. A response counts toward the day its request started. */
export function rowsFromSamples(harness: HarnessId, samples: Sample[]): ThroughputRow[] {
  const rows = new Map<string, ThroughputRow>();
  for (const s of samples) {
    if (!countsForSpeed(s)) continue;
    const day = localDateKey(new Date(s.start));
    const key = `${day}\n${s.model}`;
    let row = rows.get(key);
    if (!row) {
      row = { day, harness, model: s.model, responses: 0, outputTokens: 0, ms: 0, hist: {} };
      rows.set(key, row);
    }
    const ms = s.end - s.start;
    row.responses += 1;
    row.outputTokens += s.outputTokens;
    row.ms += ms;
    const bin = rateBin(s.outputTokens / (ms / 1000));
    row.hist[bin] = (row.hist[bin] ?? 0) + 1;
  }
  return [...rows.values()];
}

export interface SpeedSummary {
  responses: number;
  /** Output tokens over generation time, so long responses weigh more than short ones. */
  tokensPerSecond: number;
  median: number;
  p90: number;
}

function percentile(hist: Map<number, number>, total: number, p: number): number {
  const target = p * total;
  let seen = 0;
  for (const bin of [...hist.keys()].sort((a, b) => a - b)) {
    seen += hist.get(bin)!;
    if (seen >= target) return binRate(bin);
  }
  return 0;
}

export function summarizeSpeed(rows: ThroughputRow[]): SpeedSummary | null {
  let responses = 0;
  let tokens = 0;
  let ms = 0;
  const hist = new Map<number, number>();
  for (const r of rows) {
    responses += r.responses;
    tokens += r.outputTokens;
    ms += r.ms;
    for (const [bin, n] of Object.entries(r.hist)) hist.set(Number(bin), (hist.get(Number(bin)) ?? 0) + n);
  }
  if (responses === 0 || ms <= 0) return null;
  return {
    responses,
    tokensPerSecond: tokens / (ms / 1000),
    median: percentile(hist, responses, 0.5),
    p90: percentile(hist, responses, 0.9),
  };
}
