import { expect, test } from "bun:test";
import { RANGE_PRESETS, presetRange, previousRange, rangeLabel, todayKey } from "./range.ts";

test("Today is the first preset and covers only today, compared with yesterday", () => {
  expect(RANGE_PRESETS[0]).toEqual({ id: "today", label: "Today" });
  const range = presetRange("today", "2026-01-01");
  expect(range).toEqual({ preset: "today", start: todayKey(), end: todayKey() });
  expect(rangeLabel(range)).toBe("Today");
  expect(previousRange(range)?.days).toBe(1);
});
