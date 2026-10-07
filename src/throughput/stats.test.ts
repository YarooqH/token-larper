import { describe, expect, test } from "bun:test";
import { activityByDay, binValue, IDLE_GAP_MS, mergeIntervals, rateBin, rowsFromSamples, sessionsFromSamples, summarizeSpeed } from "./stats.ts";

const local = (h: number, m = 0, s = 0) => new Date(2026, 9, 5, h, m, s).getTime();

test("rate bins round-trip within 10%", () => {
  for (const rate of [2, 37, 95, 480, 3000]) {
    const back = binValue(rateBin(rate));
    expect(Math.abs(back - rate) / rate).toBeLessThan(0.1);
  }
  expect(rateBin(0)).toBe(0);
});

describe("rowsFromSamples", () => {
  test("groups by local day and model and leaves out responses too short to time", () => {
    const rows = rowsFromSamples("claude", [
      { model: "opus", start: local(10), end: local(10, 0, 10), outputTokens: 1000 },
      { model: "opus", start: local(11), end: local(11, 0, 5), outputTokens: 250 },
      { model: "opus", start: local(12), end: local(12, 0, 1), outputTokens: 5 },
      { model: "opus", start: local(13), end: local(13), outputTokens: 500 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: "2026-10-05", harness: "claude", model: "opus", responses: 2, outputTokens: 1250, ms: 15_000 });
  });
});

test("summarizeSpeed weighs by tokens and reads the median from the histogram", () => {
  const rows = rowsFromSamples("pi", [
    { model: "m", start: local(10), end: local(10, 0, 10), outputTokens: 1000 }, // 100 tok/s
    { model: "m", start: local(11), end: local(11, 0, 2), outputTokens: 40 }, // 20 tok/s
    { model: "m", start: local(12), end: local(12, 0, 2), outputTokens: 100 }, // 50 tok/s
  ]);
  const s = summarizeSpeed(rows)!;
  expect(s.responses).toBe(3);
  expect(s.tokensPerSecond).toBeCloseTo(1140 / 14, 5);
  expect(Math.abs(s.median - 50) / 50).toBeLessThan(0.1);
  expect(Math.abs(s.p90 - 100) / 100).toBeLessThan(0.1);
  expect(summarizeSpeed([])).toBeNull();
});

describe("working time", () => {
  test("joins responses separated by short gaps and splits on long ones", () => {
    const merged = mergeIntervals([
      [local(10, 5), local(10, 6)],
      [local(10), local(10, 1)],
      [local(10, 1, 30), local(10, 2)],
    ]);
    expect(merged).toEqual([
      [local(10), local(10, 2)],
      [local(10, 5), local(10, 6)],
    ]);
    expect(mergeIntervals([[0, 1], [1 + IDLE_GAP_MS, 2 + IDLE_GAP_MS]])).toHaveLength(1);
  });

  test("splits an interval that crosses midnight between the two days", () => {
    const rows = activityByDay("codex", [[new Date(2026, 9, 5, 23, 50).getTime(), new Date(2026, 9, 6, 0, 20).getTime()]]);
    expect(rows).toEqual([
      { day: "2026-10-05", harness: "codex", activeMs: 10 * 60_000 },
      { day: "2026-10-06", harness: "codex", activeMs: 20 * 60_000 },
    ]);
  });
});

describe("sessions and waits", () => {
  const samples = [
    { model: "m", start: local(10), end: local(10, 0, 10), outputTokens: 500, session: "a", firstOutputAt: local(10, 0, 2) },
    { model: "m", start: local(11), end: local(11, 0, 10), outputTokens: 500, session: "a", firstOutputAt: local(11, 0, 4) },
    { model: "m", start: local(12), end: local(12, 0, 10), outputTokens: 500 },
  ];

  test("groups by the record's session, else the file's", () => {
    const sessions = sessionsFromSamples(samples, "file-session");
    expect(Object.keys(sessions).sort()).toEqual(["a", "file-session"]);
    expect(sessions.a!.responses).toBe(2);
    expect(sessionsFromSamples(samples, undefined).a!.responses).toBe(2);
  });

  test("reports a median wait only when the tool records first output", () => {
    const withWait = summarizeSpeed([sessionsFromSamples(samples, "f").a!])!;
    expect(withWait.medianWaitMs! / 1000).toBeGreaterThan(1.8);
    expect(withWait.medianWaitMs! / 1000).toBeLessThan(2.2);
    expect(summarizeSpeed([sessionsFromSamples(samples, "f").f!])!.medianWaitMs).toBeUndefined();
  });
});
