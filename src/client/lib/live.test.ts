import { describe, expect, test } from "bun:test";
import type { LiveEvent } from "../../types.ts";
import { MINUTE, ago, forTool, liveBuckets, liveSessions, perMinute, totalsBetween } from "./live.ts";

const NOW = Date.parse("2026-10-08T10:30:20.000Z");

const ev = (over: Partial<LiveEvent> & { at: number }): LiveEvent => ({
  id: `e${over.at}${over.harness ?? ""}`,
  harness: "claude",
  model: "claude-opus-5-5",
  session: "s1",
  inputTokens: 10,
  outputTokens: 100,
  cacheCreationTokens: 0,
  cacheReadTokens: 1000,
  cost: 0.5,
  ...over,
});

const events = [
  ev({ at: NOW - 10_000, start: NOW - 14_000 }),
  ev({ at: NOW - 50_000, harness: "codex", session: "c1", model: "gpt-5.5" }),
  ev({ at: NOW - 3 * MINUTE }),
  ev({ at: NOW - 40 * MINUTE, session: "old" }),
];

describe("totalsBetween", () => {
  test("adds up the responses that finished in the window", () => {
    const t = totalsBetween(events, NOW - MINUTE, Infinity);
    expect(t.responses).toBe(2);
    expect(t.totalTokens).toBe(2 * 1110);
    expect(t.outputTokens).toBe(200);
    expect(t.cost).toBe(1);
  });

  test("narrows to one tool", () => {
    expect(totalsBetween(forTool(events, "codex"), -Infinity, Infinity).responses).toBe(1);
  });
});

describe("liveBuckets", () => {
  test("puts each response in the bar its last token landed in, the last bar holding now", () => {
    const rows = liveBuckets(events, NOW, 15_000, 60);
    expect(rows).toHaveLength(60);
    const last = rows[59]!;
    expect(Number(last.period)).toBeLessThanOrEqual(NOW);
    expect(Number(last.period) + 15_000).toBeGreaterThan(NOW);
    // 10:30:10 falls in the 10:30:00 bar, one before the bar holding 10:30:20.
    expect(last.totalTokens).toBe(0);
    expect(rows[58]!.byHarness.claude!.totalTokens).toBe(1110);
    // The 40-minute-old response is outside a 15-minute chart.
    expect(rows.reduce((a, r) => a + r.totalTokens, 0)).toBe(3 * 1110);
  });

  test("carries the list-price cost in both cost fields", () => {
    const row = liveBuckets(events, NOW, MINUTE, 60).at(-1)!;
    expect(row.verifiedCost).toBe(row.estimatedCost);
    expect(row.estimatedCost).toBeGreaterThan(0);
  });

  test("starts bars on whole multiples, so they don't drift between ticks", () => {
    const a = liveBuckets(events, NOW, MINUTE, 5).map((r) => r.period);
    const b = liveBuckets(events, NOW + 1000, MINUTE, 5).map((r) => r.period);
    expect(a).toEqual(b);
  });
});

test("perMinute gives one rolling minute per point, oldest first, ending at now", () => {
  const values = perMinute(events, NOW, 5, (t) => t.responses);
  // The last point is the last 60 seconds, the same as the headline number.
  expect(values.at(-1)).toBe(totalsBetween(events, NOW - MINUTE, Infinity).responses);
  expect(values).toEqual([0, 0, 1, 0, 2]);
});

describe("liveSessions", () => {
  test("groups by tool and session, newest first, dropping quiet ones", () => {
    const sessions = liveSessions(events, NOW, 15 * MINUTE);
    expect(sessions.map((s) => s.key)).toEqual(["claude:s1", "codex:c1"]);
    expect(sessions[0]!.totals.responses).toBe(2);
    expect(sessions[0]!.lastMinute).toBe(1110);
  });

  test("works out a speed only from responses with a start time", () => {
    const [claude, codex] = liveSessions(events, NOW, 15 * MINUTE);
    expect(claude!.speed?.tokensPerSecond).toBeCloseTo(25);
    expect(codex!.speed).toBeNull();
  });
});

test("ago", () => {
  expect(ago(1200)).toBe("now");
  expect(ago(42_000)).toBe("42 s ago");
  expect(ago(5 * MINUTE + 1)).toBe("5 min ago");
});
