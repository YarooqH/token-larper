import type { HarnessId, ThroughputPayload, ThroughputRow } from "../../types.ts";
import { summarizeSpeed, type SpeedSummary } from "../../throughput/stats.ts";
import type { HarnessFilter } from "./aggregate.ts";

// Narrows the server's per-day speed rows to the selected range and tool, the same way the
// usage numbers are narrowed, then rolls them up per tool and per model.

export interface RangeThroughput {
  byHarness: Map<HarnessId, SpeedSummary>;
  byModel: Map<string, SpeedSummary>;
  activeMs: Map<HarnessId, number>;
  exact: Set<HarnessId>;
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

  return { byHarness: rollUp(toolRows), byModel: rollUp(modelRows), activeMs, exact: new Set(payload.exact) };
}

export function formatRate(tokensPerSecond: number): string {
  return tokensPerSecond >= 100 ? Math.round(tokensPerSecond).toString() : tokensPerSecond.toFixed(1);
}

export function speedTitle(s: SpeedSummary, exact: boolean): string {
  const how = exact
    ? "Timed from when the request was sent to its last token, as the tool records it."
    : "Timed from the log line before the response to its last token, so it includes time to first token.";
  return `Output tokens per second while generating, over ${s.responses.toLocaleString("en-US")} responses. ` +
    `Median ${formatRate(s.median)}, p90 ${formatRate(s.p90)}. ${how}`;
}
