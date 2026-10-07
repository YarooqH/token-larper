import type { HarnessId, ThroughputPayload, ThroughputRow } from "../../types.ts";
import { summarizeSpeed, type SpeedSummary } from "../../throughput/stats.ts";
import type { HarnessFilter } from "./aggregate.ts";

// Narrows the server's per-day speed rows to the selected range and tool, the same way the
// usage numbers are narrowed, then rolls them up per tool and per model.

export interface RangeThroughput {
  byHarness: Map<HarnessId, SpeedSummary>;
  byModel: Map<string, SpeedSummary>;
  activeMs: Map<HarnessId, number>;
  timedByTool: Set<HarnessId>;
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
  for (const r of payload.rows) {
    if (!keep(r)) continue;
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

  return { byHarness: rollUp(toolRows), byModel: rollUp(modelRows), activeMs, timedByTool: new Set(payload.timedByTool) };
}

export function formatRate(tokensPerSecond: number): string {
  return tokensPerSecond >= 100 ? Math.round(tokensPerSecond).toString() : tokensPerSecond.toFixed(1);
}

/** Below this many responses a speed is shown dimmed, since one slow request can swing it. */
export const FEW_RESPONSES = 10;

export function speedTitle(s: SpeedSummary, timedByTool: boolean): string {
  const count = s.responses < FEW_RESPONSES
    ? `Only ${s.responses} ${s.responses === 1 ? "response" : "responses"} in this range, so treat this as rough. `
    : "";
  const source = timedByTool
    ? "The tool records when each request was sent and when its last token arrived."
    : "Timed from the log line before each response to its last token.";
  return `${count}Approximate output tokens per second over ${s.responses.toLocaleString("en-US")} ` +
    `${s.responses === 1 ? "response" : "responses"} (median ${formatRate(s.median)}, p90 ${formatRate(s.p90)}). ${source} ` +
    "That includes waiting for the first token, which grows with the size of the context, " +
    "so this reads lower than the model's own generation speed.";
}
