import { expect, test } from "bun:test";
import { mergeDailyRows } from "./dailyHistory.ts";

const day = (date: string, totalTokens: number, extra: Record<string, unknown> = {}) => ({ date, totalTokens, ...extra });

test("adds back days the fresh report no longer has", () => {
  const kept = [day("2026-09-22", 100), day("2026-09-23", 50), day("2026-09-24", 70)];
  const fresh = [day("2026-09-22", 100), day("2026-09-24", 70), day("2026-09-25", 30)];
  expect(mergeDailyRows(fresh, kept).map((r) => r.date)).toEqual(["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"]);
});

test("keeps the bigger kept row when a day lost some of its logs", () => {
  const merged = mergeDailyRows([day("2026-09-14", 3_000)], [day("2026-09-14", 60_000)]);
  expect(merged).toEqual([day("2026-09-14", 60_000)]);
});

test("takes the fresh row when it has as many tokens or more", () => {
  const grown = mergeDailyRows([day("2026-10-17", 900, { costUSD: 2 })], [day("2026-10-17", 500, { costUSD: 1 })]);
  expect(grown).toEqual([day("2026-10-17", 900, { costUSD: 2 })]);
  // Same tokens, new price: the fresh cost wins.
  const repriced = mergeDailyRows([day("2026-10-01", 500, { costUSD: 3 })], [day("2026-10-01", 500, { costUSD: 1 })]);
  expect(repriced[0]!.costUSD).toBe(3);
});

test("compares token sums when a row has no totalTokens", () => {
  const kept = [{ date: "2026-09-01", inputTokens: 10, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 80 }];
  const fresh = [{ date: "2026-09-01", inputTokens: 5, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 10 }];
  expect(mergeDailyRows(fresh, kept)).toEqual(kept);
});

test("ignores rows without a date", () => {
  expect(mergeDailyRows([{ totalTokens: 5 }, day("2026-09-01", 1)], [{ totalTokens: 9 }])).toEqual([day("2026-09-01", 1)]);
});
