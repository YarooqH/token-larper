import { useEffect, useState } from "react";
import type { HarnessId, LiveEvent, LiveSnapshot, LiveUpdate, PeriodHarnessBreakdown, TimePeriodRow } from "../../types.ts";
import { rowsFromSamples, summarizeSpeed, type Sample, type SpeedSummary } from "../../throughput/stats.ts";
import type { HarnessFilter } from "./aggregate.ts";

// Rolling numbers for the Live tab, worked out in the browser from the responses the server
// pushes, so they keep moving every second without asking the server again.

export const MINUTE = 60_000;

export interface LiveTotals {
  responses: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
}

export const eventTokens = (e: LiveEvent) => e.inputTokens + e.outputTokens + e.cacheCreationTokens + e.cacheReadTokens;

export function forTool(events: LiveEvent[], harness: HarnessFilter): LiveEvent[] {
  return harness === "all" ? events : events.filter((e) => e.harness === harness);
}

/** Totals for responses that finished in [from, to). */
export function totalsBetween(events: LiveEvent[], from: number, to: number): LiveTotals {
  const t: LiveTotals = { responses: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, cost: 0 };
  for (const e of events) {
    if (e.at < from || e.at >= to) continue;
    t.responses += 1;
    t.inputTokens += e.inputTokens;
    t.outputTokens += e.outputTokens;
    t.cacheCreationTokens += e.cacheCreationTokens;
    t.cacheReadTokens += e.cacheReadTokens;
    t.totalTokens += eventTokens(e);
    t.cost += e.cost;
  }
  return t;
}

/**
 * `count` bars of `bucketMs` each, the last one holding `now`, shaped like the dashboard's
 * period rows so the usage chart can draw them. Bars start on whole multiples of the bucket,
 * so they only shift when a new one begins.
 */
export function liveBuckets(events: LiveEvent[], now: number, bucketMs: number, count: number): TimePeriodRow[] {
  const end = Math.floor(now / bucketMs) * bucketMs + bucketMs;
  const start = end - count * bucketMs;
  const rows: TimePeriodRow[] = Array.from({ length: count }, (_, i) => {
    const at = start + i * bucketMs;
    return {
      period: String(at),
      label: new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(bucketMs < MINUTE ? { second: "2-digit" } : {}) }),
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      verifiedCost: 0,
      estimatedCost: 0,
      byHarness: {},
      modelsUsed: [],
    };
  });
  for (const e of events) {
    if (e.at < start || e.at >= end) continue;
    const row = rows[Math.floor((e.at - start) / bucketMs)]!;
    const tokens = eventTokens(e);
    const hb: PeriodHarnessBreakdown = (row.byHarness[e.harness] ??= {
      harness: e.harness,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      verifiedCost: 0,
      estimatedCost: 0,
      models: [],
    });
    for (const into of [row, hb]) {
      into.inputTokens += e.inputTokens;
      into.outputTokens += e.outputTokens;
      into.cacheCreationTokens += e.cacheCreationTokens;
      into.cacheReadTokens += e.cacheReadTokens;
      into.totalTokens += tokens;
      // Live costs are all list-price estimates; both fields carry them so either cost mode reads the same.
      into.verifiedCost += e.cost;
      into.estimatedCost += e.cost;
    }
    if (!row.modelsUsed.includes(e.model)) row.modelsUsed.push(e.model);
  }
  return rows;
}

/**
 * One value per minute over the last `minutes`, oldest first, for a sparkline. Each covers
 * the 60 seconds up to a whole number of minutes before now, so the last one matches the
 * "last minute" figure instead of dipping while the current minute fills up.
 */
export function perMinute(events: LiveEvent[], now: number, minutes: number, pick: (t: LiveTotals) => number): number[] {
  return Array.from({ length: minutes }, (_, i) => {
    const to = now - (minutes - 1 - i) * MINUTE;
    return pick(totalsBetween(events, to - MINUTE, i === minutes - 1 ? Infinity : to));
  });
}

/** Output speed over responses whose start is known, the same way the Tools tab works it out. */
export function liveSpeed(events: LiveEvent[]): SpeedSummary | null {
  const samples: Sample[] = [];
  for (const e of events) {
    if (e.start !== undefined) samples.push({ model: e.model, start: e.start, end: e.at, outputTokens: e.outputTokens });
  }
  return samples.length ? summarizeSpeed(rowsFromSamples("claude", samples)) : null;
}

export interface LiveSession {
  key: string;
  harness: HarnessId;
  project?: string;
  models: string[];
  lastAt: number;
  /** Tokens in the last minute. */
  lastMinute: number;
  totals: LiveTotals;
  speed: SpeedSummary | null;
}

/** Sessions with a response in the last `withinMs`, most recently active first. */
export function liveSessions(events: LiveEvent[], now: number, withinMs: number): LiveSession[] {
  const groups = new Map<string, LiveEvent[]>();
  for (const e of events) {
    const key = `${e.harness}:${e.session ?? e.project ?? e.model}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out: LiveSession[] = [];
  for (const [key, list] of groups) {
    const lastAt = Math.max(...list.map((e) => e.at));
    if (now - lastAt > withinMs) continue;
    const latest = list.find((e) => e.at === lastAt)!;
    const models = [...new Set([...list].sort((a, b) => b.at - a.at).map((e) => e.model))];
    out.push({
      key,
      harness: latest.harness,
      project: list.find((e) => e.project)?.project,
      models,
      lastAt,
      lastMinute: totalsBetween(list, now - MINUTE, Infinity).totalTokens,
      totals: totalsBetween(list, -Infinity, Infinity),
      speed: liveSpeed(list),
    });
  }
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

/** "now", "12 s ago", "4 min ago". */
export function ago(ms: number): string {
  if (ms < 5_000) return "now";
  if (ms < MINUTE) return `${Math.floor(ms / 1000)} s ago`;
  return `${Math.floor(ms / MINUTE)} min ago`;
}

export type LiveStatus = "connecting" | "live" | "reconnecting";

export interface LiveFeed {
  status: LiveStatus;
  /** Null until the server has read the last hour. */
  snapshot: Omit<LiveSnapshot, "events"> | null;
  events: LiveEvent[];
  now: number;
}

/** Follows /api/live while mounted and ticks once a second so rolling windows move on their own. */
export function useLiveFeed(): LiveFeed {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [snapshot, setSnapshot] = useState<LiveFeed["snapshot"]>(null);
  const [byId, setById] = useState<Map<string, LiveEvent>>(() => new Map());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const source = new EventSource("/api/live");
    source.addEventListener("snapshot", (message) => {
      const s = JSON.parse((message as MessageEvent<string>).data) as LiveSnapshot;
      const { events, ...meta } = s;
      setSnapshot(meta);
      setById(new Map(events.map((e) => [e.id, e])));
      setStatus("live");
    });
    source.addEventListener("update", (message) => {
      const u = JSON.parse((message as MessageEvent<string>).data) as LiveUpdate;
      setSnapshot((s) => (s ? { ...s, files: u.files } : s));
      setById((prev) => {
        const next = new Map(prev);
        for (const e of u.events) next.set(e.id, e);
        return next;
      });
    });
    // EventSource reconnects by itself; the server answers a reconnect with a fresh snapshot.
    source.onerror = () => setStatus((s) => (s === "connecting" ? s : "reconnecting"));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      source.close();
      clearInterval(tick);
    };
  }, []);

  const windowMs = snapshot?.windowMs ?? 60 * MINUTE;
  const events = [...byId.values()].filter((e) => now - e.at <= windowMs);
  return { status, snapshot, events, now };
}
