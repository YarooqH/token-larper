import { describe, expect, test } from "bun:test";
import type { DashboardPayload } from "../../types.ts";
import { dayStreak } from "./rank.ts";

// dayStreak only reads data.daily, so the rest of the payload can stay empty.
const withDays = (...periods: string[]) =>
  ({ daily: periods.map((period) => ({ period, totalTokens: 1000 })) }) as unknown as DashboardPayload;

describe("dayStreak", () => {
  test("counts consecutive days ending today", () => {
    const data = withDays("2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05");
    expect(dayStreak(data, "2026-10-05")).toEqual({ days: 4, doneToday: true });
  });

  test("keeps yesterday's streak alive until today is missed, but not lit", () => {
    const data = withDays("2026-10-03", "2026-10-04");
    expect(dayStreak(data, "2026-10-05")).toEqual({ days: 2, doneToday: false });
  });

  test("resets after a missed day", () => {
    const data = withDays("2026-10-01", "2026-10-02", "2026-10-03");
    expect(dayStreak(data, "2026-10-05")).toEqual({ days: 0, doneToday: false });
  });

  test("only the run touching today counts, not the longest one", () => {
    const data = withDays("2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-10-04", "2026-10-05");
    expect(dayStreak(data, "2026-10-05").days).toBe(2);
  });

  test("ignores days without usage and unsorted input", () => {
    const data = {
      daily: [
        { period: "2026-10-05", totalTokens: 10 },
        { period: "2026-10-04", totalTokens: 0 },
        { period: "2026-10-03", totalTokens: 10 },
      ],
    } as unknown as DashboardPayload;
    expect(dayStreak(data, "2026-10-05")).toEqual({ days: 1, doneToday: true });
  });

  test("is zero with no usage at all", () => {
    expect(dayStreak(withDays(), "2026-10-05")).toEqual({ days: 0, doneToday: false });
  });
});
