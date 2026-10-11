import type { HarnessId, ThroughputPayload, ThroughputRow } from "../../types.ts";
import { summarizeSpeed, type SpeedSummary } from "../../throughput/stats.ts";
import type { HarnessFilter } from "./aggregate.ts";

// Narrows the server's per-day speed rows to the selected range and tool, the same way the
// usage numbers are narrowed, then rolls them up per tool and per model. Sessions keep their
// whole-life speed, since the session list itself is what the range narrows.

export interface RangeThroughput {
  byHarness: Map<HarnessId, SpeedSummary>;
  byModel: Map<string, SpeedSummary>;
  activeMs: Map<HarnessId, number>;
  /** Keyed by SessionEntry.id. */
  bySession: Map<string, SpeedSummary>;
  timedByTool: Set<HarnessId>;
  /** The per-day rows in the range, for speed over time. */
  rows: ThroughputRow[];
  /** modelKey()s with the selected tool's models first by all-time responses, so chart colors don't change with the range. */
  modelOrder: string[];
}

export const modelKey = (harness: HarnessId, model: string) => `${harness}::${model}`;

export function throughputInRange(
  payload: ThroughputPayload | null,
  harness: HarnessFilter,
  start: string,
  end: string,
): RangeThroughput | null {
  if (!payload || payload.status !== "ready") return null;
  const keep = (r: { day: string; harness: HarnessId }) =>
    r.day >= start && r.day <= end && (harness === "all" || r.harness === harness);

  const toolRows = new Map<HarnessId, ThroughputRow[]>();
  const modelRows = new Map<string, ThroughputRow[]>();
  const add = <K>(map: Map<K, ThroughputRow[]>, key: K, r: ThroughputRow) => {
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  };
  const rows: ThroughputRow[] = [];
  const allTime = new Map<string, number>();
  for (const r of payload.rows) {
    if (harness === "all" || r.harness === harness) {
      const key = modelKey(r.harness, r.model);
      allTime.set(key, (allTime.get(key) ?? 0) + r.responses);
    }
    if (!keep(r)) continue;
    rows.push(r);
    add(toolRows, r.harness, r);
    add(modelRows, modelKey(r.harness, r.model), r);
  }
  const rollUp = <K>(groups: Map<K, ThroughputRow[]>) => {
    const out = new Map<K, SpeedSummary>();
    for (const [k, rows] of groups) {
      const s = summarizeSpeed(rows);
      if (s) out.set(k, s);
    }
    return out;
  };

  const activeMs = new Map<HarnessId, number>();
  for (const a of payload.activity) if (keep(a)) activeMs.set(a.harness, (activeMs.get(a.harness) ?? 0) + a.activeMs);

  const bySession = new Map<string, SpeedSummary>();
  for (const [id, totals] of Object.entries(payload.sessions ?? {})) {
    const s = summarizeSpeed([totals]);
    if (s) bySession.set(id, s);
  }

  return {
    byHarness: rollUp(toolRows),
    byModel: rollUp(modelRows),
    activeMs,
    bySession,
    timedByTool: new Set(payload.timedByTool),
    rows,
    modelOrder: [...allTime].sort((a, b) => b[1] - a[1]).map(([key]) => key),
  };
}

export function formatRate(tokensPerSecond: number): string {
  return tokensPerSecond >= 100 ? Math.round(tokensPerSecond).toString() : tokensPerSecond.toFixed(1);
}

/** Below this many responses a speed is shown dimmed, since one slow request can swing it. */
export const FEW_RESPONSES = 10;

export function formatWait(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : ms < 120_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

export function speedTitle(s: SpeedSummary, timedByTool: boolean, scope: "range" | "session" = "range"): string {
  const plural = (n: number) => (n === 1 ? "response" : "responses");
  const count = s.responses < FEW_RESPONSES
    ? `Only ${s.responses} ${plural(s.responses)} in this ${scope}, so treat this as rough. `
    : "";
  const source = timedByTool
    ? "The tool records when each request was sent and when its last token arrived."
    : "Timed from the log line before each response to its last token.";
  const wait = s.medianWaitMs !== undefined ? ` Typical wait for the first output: ${formatWait(s.medianWaitMs)}.` : "";
  return `${count}Approximate output tokens per second over ${s.responses.toLocaleString("en-US")} ` +
    `${plural(s.responses)} (median ${formatRate(s.median)}, p90 ${formatRate(s.p90)}). ${source} ` +
    "That includes waiting for the first token, which grows with the size of the context, " +
    `so this reads lower than the model's own generation speed.${wait}`;
}
