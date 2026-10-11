import { describe, expect, test } from "bun:test";
import type { HarnessId, ThroughputRow } from "../../types.ts";
import type { RangeThroughput } from "../lib/throughput.ts";
import { rateBin } from "../../throughput/stats.ts";
import { SpeedTrend } from "./SpeedTrend.tsx";
import { render } from "../testing/dashboard.tsx";

const row = (day: string, harness: HarnessId, model: string, responses: number, tps: number): ThroughputRow => ({
  day,
  harness,
  model,
  responses,
  outputTokens: responses * tps * 10,
  ms: responses * 10_000,
  hist: { [rateBin(tps)]: responses },
});

const throughput = (rows: ThroughputRow[], modelOrder: string[] = []): RangeThroughput => ({
  byHarness: new Map(),
  byModel: new Map(),
  activeMs: new Map(),
  bySession: new Map(),
  timedByTool: new Set(),
  rows,
  modelOrder,
});

const range = { preset: "custom" as const, start: "2026-10-01", end: "2026-10-03" };

describe("Speed over time", () => {
  test("draws one line per tool, per day, with a legend", () => {
    const rows = [row("2026-10-01", "claude", "claude-opus-5-5", 20, 80), row("2026-10-02", "codex", "gpt-5.5", 3, 40)];
    const html = render(<SpeedTrend group="tool" />, { throughput: throughput(rows), range });
    expect(html).toContain("Speed over time");
    expect(html).toContain("per day");
    expect(html).toContain('class="legend-item"');
    expect(html).toContain("claude");
    expect(html).toContain("codex");
  });

  test("names models with their tool when every tool is shown", () => {
    const rows = [row("2026-10-01", "claude", "claude-opus-5-5", 20, 80)];
    const html = render(<SpeedTrend group="model" />, { throughput: throughput(rows), range });
    expect(html).toContain("claude-opus-5-5 · claude");
  });

  test("keeps the chart to seven models and says how many are left out", () => {
    const rows = Array.from({ length: 9 }, (_, i) => row("2026-10-01", "pi", `model-${i}`, 20 - i, 50));
    const html = render(<SpeedTrend group="model" />, { throughput: throughput(rows), range });
    expect(html).toContain("2 more are left out");
    expect(html).toContain("model-0");
    expect(html).not.toContain("model-8");
  });

  test("waits for the first scan, and says when nothing was timed", () => {
    expect(render(<SpeedTrend group="tool" />, { throughput: null, range })).toContain("once the first read");
    expect(render(<SpeedTrend group="tool" />, { throughput: throughput([]), range })).toContain("No timed responses in this range");
  });
});
