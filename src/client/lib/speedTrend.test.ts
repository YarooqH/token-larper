import { describe, expect, test } from "bun:test";
import type { HarnessId, ThroughputRow } from "../../types.ts";
import { rateBin } from "../../throughput/stats.ts";
import { defaultSpeedBucket, metricValue, speedTrend } from "./speedTrend.ts";

/** `responses` responses of `out` tokens over `secs` seconds each. */
const row = (day: string, harness: HarnessId, model: string, responses: number, out: number, secs: number): ThroughputRow => ({
  day,
  harness,
  model,
  responses,
  outputTokens: responses * out,
  ms: responses * secs * 1000,
  hist: { [rateBin(out / secs)]: responses },
});

const rows = [
  row("2026-10-05", "claude", "claude-opus-5-5", 10, 500, 10), // 50 tok/s, Monday
  row("2026-10-06", "claude", "claude-opus-5-5", 10, 1000, 10), // 100 tok/s, Tuesday
  row("2026-10-06", "codex", "gpt-5.5", 4, 300, 10), // 30 tok/s
  row("2026-09-20", "claude", "claude-opus-5-5", 3, 200, 10), // outside the range
];

const byTool = (r: ThroughputRow) => r.harness;

describe("speedTrend", () => {
  test("has a period for every day in the range, with gaps as null", () => {
    const t = speedTrend(rows, "daily", "2026-10-04", "2026-10-07", byTool);
    expect(t.periods.map((p) => p.key)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
    const claude = t.bySeries.get("claude")!;
    expect(claude[0]).toBeNull();
    expect(claude[1]!.tokensPerSecond).toBe(50);
    expect(claude[2]!.tokensPerSecond).toBe(100);
    expect(claude[3]).toBeNull();
    expect(t.bySeries.get("codex")![2]!.tokensPerSecond).toBe(30);
  });

  test("merges a week's days before summarizing, weighting by response time", () => {
    const t = speedTrend(rows, "weekly", "2026-10-05", "2026-10-11", byTool);
    expect(t.periods).toHaveLength(1);
    const week = t.bySeries.get("claude")![0]!;
    expect(week.responses).toBe(20);
    expect(week.tokensPerSecond).toBe(75);
  });

  test("groups by model when asked", () => {
    const t = speedTrend(rows, "monthly", "2026-10-01", "2026-10-31", (r) => `${r.harness}::${r.model}`);
    expect([...t.bySeries.keys()].sort()).toEqual(["claude::claude-opus-5-5", "codex::gpt-5.5"]);
  });

  test("leaves out rows outside the range", () => {
    const t = speedTrend(rows, "daily", "2026-10-05", "2026-10-06", byTool);
    expect(t.bySeries.get("claude")!.reduce((a, s) => a + (s?.responses ?? 0), 0)).toBe(20);
  });
});

test("metricValue picks the average or the median", () => {
  const s = { responses: 3, tokensPerSecond: 80, median: 60, p90: 120 };
  expect(metricValue(s, "average")).toBe(80);
  expect(metricValue(s, "median")).toBe(60);
});

test("defaultSpeedBucket keeps lines readable as the range grows", () => {
  expect(defaultSpeedBucket(30)).toBe("daily");
  expect(defaultSpeedBucket(90)).toBe("weekly");
  expect(defaultSpeedBucket(800)).toBe("monthly");
});
