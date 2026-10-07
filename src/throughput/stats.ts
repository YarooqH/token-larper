import type { ActivityRow, HarnessId, SpeedTotals, ThroughputRow } from "../types.ts";
import { localDateKey } from "../client/utils.ts";

// Shared by the server, which turns parsed responses into per-day rows, and the dashboard,
// which merges the rows for whatever range and tool are selected. Nothing here touches disk.

/** One model response: when the request went out, when the last token arrived, and how many it produced. */
export interface Sample {
  model: string;
  start: number;
  end: number;
  outputTokens: number;
  /** When the first output arrived, for tools that record it. */
  firstOutputAt?: number;
  /** The session the response belongs to, when the record names it; otherwise the file's session. */
  session?: string;
}

export type Interval = [start: number, end: number];

/** Gaps between responses up to this long are tool calls or a quick reply, so they count as working time. */
export const IDLE_GAP_MS = 2 * 60_000;

// Short replies are mostly time to first token, and a response that runs for half an hour
// is a stalled stream, so neither says much about speed.
const MIN_TOKENS = 20;
const MIN_MS = 200;
const MAX_MS = 30 * 60_000;

// Rates and waits are bucketed on a log scale, 10% per bin, so a range's median and p90 come
// from summing bins instead of keeping every response.
const BIN_GROWTH = Math.log(1.1);
const MAX_RATE_BIN = 100; // about 13,800 tok/s
const MAX_WAIT_BIN = 160; // about 4.2 hours, in milliseconds

function logBin(value: number, max: number): number {
  if (!(value > 1)) return 0;
  return Math.min(max, Math.floor(Math.log(value) / BIN_GROWTH));
}

export const rateBin = (tokensPerSecond: number) => logBin(tokensPerSecond, MAX_RATE_BIN);
export const waitBin = (ms: number) => logBin(ms, MAX_WAIT_BIN);

/** The geometric middle of a bin: tok/s for a rate bin, milliseconds for a wait bin. */
export function binValue(bin: number): number {
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

export const emptyTotals = (): SpeedTotals => ({ responses: 0, outputTokens: 0, ms: 0, hist: {} });

function addSample(into: SpeedTotals, s: Sample): void {
  const ms = s.end - s.start;
  into.responses += 1;
  into.outputTokens += s.outputTokens;
  into.ms += ms;
  const bin = rateBin(s.outputTokens / (ms / 1000));
  into.hist[bin] = (into.hist[bin] ?? 0) + 1;
  if (s.firstOutputAt !== undefined && s.firstOutputAt >= s.start && s.firstOutputAt <= s.end) {
    const waits = (into.waits ??= {});
    const w = waitBin(s.firstOutputAt - s.start);
    waits[w] = (waits[w] ?? 0) + 1;
  }
}

function addHist(into: Record<number, number>, from: Record<number, number>): void {
  for (const [bin, n] of Object.entries(from)) into[Number(bin)] = (into[Number(bin)] ?? 0) + n;
}

export function addTotals(into: SpeedTotals, from: SpeedTotals): void {
  into.responses += from.responses;
  into.outputTokens += from.outputTokens;
  into.ms += from.ms;
  addHist(into.hist, from.hist);
  if (from.waits) addHist((into.waits ??= {}), from.waits);
}

/** Per-day, per-model speed rows for one tool. A response counts toward the day its request started. */
export function rowsFromSamples(harness: HarnessId, samples: Sample[]): ThroughputRow[] {
  const rows = new Map<string, ThroughputRow>();
  for (const s of samples) {
    if (!countsForSpeed(s)) continue;
    const day = localDateKey(new Date(s.start));
    const key = `${day}
${s.model}`;
    let row = rows.get(key);
    if (!row) {
      row = { day, harness, model: s.model, ...emptyTotals() };
      rows.set(key, row);
    }
    addSample(row, s);
  }
  return [...rows.values()];
}

/** Speed totals per session, keyed by session id. */
export function sessionsFromSamples(samples: Sample[], fallback: string | undefined): Record<string, SpeedTotals> {
  const out: Record<string, SpeedTotals> = {};
  for (const s of samples) {
    const session = s.session ?? fallback;
    if (!session || !countsForSpeed(s)) continue;
    addSample((out[session] ??= emptyTotals()), s);
  }
  return out;
}

export interface SpeedSummary {
  responses: number;
  /** Output tokens over total response time, so long responses weigh more than short ones. */
  tokensPerSecond: number;
  median: number;
  p90: number;
  /** Median wait for the first output, for tools that record when it arrived. */
  medianWaitMs?: number;
}

function percentile(hist: Record<number, number>, p: number): number {
  const bins = Object.keys(hist).map(Number).sort((a, b) => a - b);
  const total = bins.reduce((acc, b) => acc + hist[b]!, 0);
  let seen = 0;
  for (const bin of bins) {
    seen += hist[bin]!;
    if (seen >= p * total) return binValue(bin);
  }
  return 0;
}

export function summarizeSpeed(rows: SpeedTotals[]): SpeedSummary | null {
  const t = emptyTotals();
  for (const r of rows) addTotals(t, r);
  if (t.responses === 0 || t.ms <= 0) return null;
  return {
    responses: t.responses,
    tokensPerSecond: t.outputTokens / (t.ms / 1000),
    median: percentile(t.hist, 0.5),
    p90: percentile(t.hist, 0.9),
    ...(t.waits ? { medianWaitMs: percentile(t.waits, 0.5) } : {}),
  };
}
