import { useEffect, useState, useSyncExternalStore } from "react";
import type { HarnessId, LiveEvent, LiveSnapshot, LiveUpdate, PeriodHarnessBreakdown, TimePeriodRow } from "../../types.ts";
import { countsForSpeed, rowsFromSamples, summarizeSpeed, type Sample, type SpeedSummary } from "../../throughput/stats.ts";
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
    if (e.start !== undefined) samples.push({ model: e.model, start: e.start, end: e.at, outputTokens: generated(e) });
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
  /** The latest response's whole prompt (input, cache write and cache read): how full its context was. */
  context: number;
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
      context: latest.inputTokens + latest.cacheCreationTokens + latest.cacheReadTokens,
    });
  }
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

/** Everything the model wrote, thinking included, for speed. */
const generated = (e: LiveEvent) => e.outputTokens + (e.reasoningTokens ?? 0);

/** One response's output speed, or null when its start isn't known or it is too short to say. */
export function responseSpeed(e: LiveEvent): number | null {
  if (e.start === undefined) return null;
  const sample = { model: e.model, start: e.start, end: e.at, outputTokens: generated(e) };
  return countsForSpeed(sample) ? sample.outputTokens / ((e.at - e.start) / 1000) : null;
}

export interface RollingSeries {
  /** Sample times, oldest first; the last is now. */
  times: number[];
  /** Tokens in the minute up to each sample time, per key. */
  byKey: Map<string, number[]>;
}

/**
 * Tokens per minute as a rolling 60-second sum, sampled every `stepMs` over the last `spanMs`
 * for each key. The last sample equals the "last minute" figure, so the trace and the headline
 * number always agree.
 */
export function rollingSeries(events: LiveEvent[], now: number, spanMs: number, stepMs: number, keyOf: (e: LiveEvent) => string): RollingSeries {
  const count = Math.floor(spanMs / stepMs) + 1;
  const times = Array.from({ length: count }, (_, i) => now - (count - 1 - i) * stepMs);
  const byKey = new Map<string, number[]>();
  const first = times[0]! - MINUTE;
  for (const e of events) {
    if (e.at <= first || e.at > now) continue;
    const key = keyOf(e);
    let values = byKey.get(key);
    if (!values) byKey.set(key, (values = new Array<number>(count).fill(0)));
    const tokens = eventTokens(e);
    // The event counts toward every sample in (at, at + 1 min].
    const from = Math.max(0, Math.ceil((e.at - times[0]!) / stepMs));
    for (let i = from; i < count && times[i]! - e.at < MINUTE; i++) if (times[i]! >= e.at) values[i]! += tokens;
  }
  return { times, byKey };
}

export interface Ranked {
  key: string;
  harness: HarnessId;
  model?: string;
  totals: LiveTotals;
  /** Tokens in the last minute. */
  lastMinute: number;
  speed: SpeedSummary | null;
}

/** Totals since `from` per tool or per model, largest first. */
export function rankBy(events: LiveEvent[], from: number, now: number, by: "tool" | "model"): Ranked[] {
  const groups = new Map<string, LiveEvent[]>();
  for (const e of events) {
    if (e.at < from) continue;
    const key = by === "tool" ? e.harness : `${e.harness}::${e.model}`;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  return [...groups]
    .map(([key, list]): Ranked => ({
      key,
      harness: list[0]!.harness,
      ...(by === "model" ? { model: list[0]!.model } : {}),
      totals: totalsBetween(list, -Infinity, Infinity),
      lastMinute: totalsBetween(list, now - MINUTE, Infinity).totalTokens,
      speed: liveSpeed(list),
    }))
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
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

// One connection to /api/live, shared by everything that shows live data. It opens when Live
// mode is about to show (hovering its toggle counts) and closes a while after the last user
// leaves; what it read stays, so coming back draws at once while a fresh snapshot loads.

interface FeedState {
  status: LiveStatus;
  snapshot: LiveFeed["snapshot"];
  byId: Map<string, LiveEvent>;
}

/** Stays open this long without a user, so leaving and coming back doesn't reconnect. */
const LINGER_MS = 20_000;

let feed: FeedState = { status: "connecting", snapshot: null, byId: new Map() };
let source: EventSource | null = null;
let users = 0;
let lingerTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
let waiters: (() => void)[] = [];

function setFeed(next: FeedState): void {
  feed = next;
  for (const listener of listeners) listener();
  if (next.snapshot) {
    for (const resolve of waiters) resolve();
    waiters = [];
  }
}

function open(): void {
  clearTimeout(lingerTimer);
  if (source || typeof EventSource === "undefined") return;
  const es = new EventSource("/api/live");
  source = es;
  es.addEventListener("snapshot", (message) => {
    const { events, ...meta } = JSON.parse((message as MessageEvent<string>).data) as LiveSnapshot;
    setFeed({ status: "live", snapshot: meta, byId: new Map(events.map((e) => [e.id, e])) });
  });
  es.addEventListener("update", (message) => {
    const u = JSON.parse((message as MessageEvent<string>).data) as LiveUpdate;
    const byId = new Map(feed.byId);
    for (const e of u.events) byId.set(e.id, e);
    const snapshot = feed.snapshot && { ...feed.snapshot, files: u.files, ...(u.plan !== undefined ? { plan: u.plan } : {}) };
    setFeed({ ...feed, snapshot, byId });
  });
  // EventSource reconnects by itself; the server answers a reconnect with a fresh snapshot.
  es.onerror = () => {
    if (feed.status === "live") setFeed({ ...feed, status: "reconnecting" });
  };
}

function lingerThenClose(): void {
  clearTimeout(lingerTimer);
  lingerTimer = setTimeout(() => {
    if (users > 0 || !source) return;
    source.close();
    source = null;
    setFeed({ ...feed, status: "connecting" });
  }, LINGER_MS);
}

/** Starts reading ahead of Live mode showing, e.g. when the pointer reaches its toggle. */
export function prepareLiveFeed(): void {
  open();
  if (users === 0) lingerThenClose();
}

/** Resolves once there is something to draw (a snapshot, or one kept from earlier), or after `timeoutMs`. */
export function liveFeedReady(timeoutMs: number): Promise<void> {
  prepareLiveFeed();
  if (feed.snapshot) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
    setTimeout(resolve, timeoutMs);
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The shared feed while mounted, ticking once a second so rolling windows move on their own. */
export function useLiveFeed(): LiveFeed {
  const state = useSyncExternalStore(subscribe, () => feed, () => feed);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    users += 1;
    open();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      users -= 1;
      clearInterval(tick);
      if (users === 0) lingerThenClose();
    };
  }, []);

  const windowMs = state.snapshot?.windowMs ?? 60 * MINUTE;
  const events = [...state.byId.values()].filter((e) => now - e.at <= windowMs);
  return { status: state.status, snapshot: state.snapshot, events, now };
}
