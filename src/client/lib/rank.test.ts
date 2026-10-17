import { describe, expect, test } from "bun:test";
import type { DashboardPayload } from "../../types.ts";
import { fakeDashboard } from "../testing/dashboard.tsx";
import { DAILY_GOAL, dayStreak, FREEZE_EVERY, lifetimeStats } from "./rank.ts";

// dayStreak only reads data.daily, so the rest of the payload can stay empty.
const withDays = (...periods: string[]) =>
  ({ daily: periods.map((period) => ({ period, totalTokens: 1000 })) }) as unknown as DashboardPayload;
const withTokens = (days: Record<string, number>): DashboardPayload =>
  ({ daily: Object.entries(days).map(([period, totalTokens]) => ({ period, totalTokens })) }) as unknown as DashboardPayload;

describe("dayStreak", () => {
  test("counts consecutive days ending today", () => {
    const data = withDays("2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05");
    expect(dayStreak(data, "2026-10-05")).toMatchObject({ days: 4, doneToday: true });
  });

  test("keeps yesterday's streak alive until today is missed, but not lit", () => {
    const data = withDays("2026-10-03", "2026-10-04");
    expect(dayStreak(data, "2026-10-05")).toMatchObject({ days: 2, doneToday: false, goalMet: false });
  });

  test("resets after a missed day", () => {
    const data = withDays("2026-10-01", "2026-10-02", "2026-10-03");
    expect(dayStreak(data, "2026-10-05")).toMatchObject({ days: 0, doneToday: false });
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
    expect(dayStreak(data, "2026-10-05")).toMatchObject({ days: 1, doneToday: true });
  });

  test("is zero with no usage at all", () => {
    expect(dayStreak(withDays(), "2026-10-05")).toMatchObject({ days: 0, doneToday: false, freezes: 0 });
  });

  test("lights the flame only once today reaches the daily goal", () => {
    expect(dayStreak(withTokens({ "2026-10-05": DAILY_GOAL - 1 }), "2026-10-05")).toMatchObject({ doneToday: true, goalMet: false });
    expect(dayStreak(withTokens({ "2026-10-05": DAILY_GOAL }), "2026-10-05")).toMatchObject({
      doneToday: true,
      goalMet: true,
      todayTokens: DAILY_GOAL,
    });
  });
});

describe("streak freezes", () => {
  test("earns one freeze per 500M lifetime tokens", () => {
    const s = dayStreak(withTokens({ "2026-10-04": 1.2e9 }), "2026-10-04");
    expect(s.freezes).toBe(2);
    expect(s.nextFreezeIn).toBe(3 * FREEZE_EVERY - 1.2e9);
  });

  test("a freeze covers a missed day, which keeps the run but adds no day", () => {
    const data = withTokens({ "2026-10-01": 600e6, "2026-10-03": 1000, "2026-10-04": 1000 });
    expect(dayStreak(data, "2026-10-04")).toMatchObject({ days: 3, freezes: 0, frozen: ["2026-10-02"] });
  });

  test("a gap longer than the freezes in hand breaks the run and keeps the freezes", () => {
    const data = withTokens({ "2026-10-01": 600e6, "2026-10-04": 1000 });
    expect(dayStreak(data, "2026-10-04")).toMatchObject({ days: 1, freezes: 1, frozen: [] });
  });

  test("freezes earned after a gap can't cover it", () => {
    const data = withTokens({ "2026-10-01": 1000, "2026-10-03": 600e6 });
    expect(dayStreak(data, "2026-10-03")).toMatchObject({ days: 1, freezes: 1, frozen: [] });
  });

  test("covers missed days right before today", () => {
    const data = withTokens({ "2026-10-01": 600e6 });
    expect(dayStreak(data, "2026-10-03")).toMatchObject({ days: 1, doneToday: false, freezes: 0, frozen: ["2026-10-02"] });
  });

  test("count toward the longest streak too", () => {
    // lifetimeStats reads the whole payload, so start from a full fake one.
    const data = { ...fakeDashboard().data, ...withTokens({ "2026-09-01": 600e6, "2026-09-03": 1000, "2026-09-04": 1000 }) };
    expect(lifetimeStats(data).longestStreak).toMatchObject({ days: 3, start: "2026-09-01", end: "2026-09-04", frozen: ["2026-09-02"] });
  });
});
