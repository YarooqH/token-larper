import { describe, expect, test } from "bun:test";
import type { DashboardPayload, TimePeriodRow } from "../../types.ts";
import { TIERS } from "../lib/rank.ts";
import { addDays, todayKey } from "../lib/range.ts";
import { fakeDashboard, render } from "../testing/dashboard.tsx";
import { Rank } from "./Rank.tsx";

// The Stats tab leads with the day streak, then shows rank as one plain row.

// Each day defaults to 1M tokens, over the daily goal. dayTokens overrides it by days ago.
function view(daysAgo: number[], tokens = 5.2e9, dayTokens: Record<number, number> = {}) {
  const base = fakeDashboard().data;
  const template = base.daily[0]!;
  const daily: TimePeriodRow[] = daysAgo.map((n) => ({ ...template, period: addDays(todayKey(), -n), totalTokens: dayTokens[n] ?? 1e6 }));
  const data: DashboardPayload = { ...base, daily, totals: { ...base.totals, totalTokens: tokens } };
  return render(<Rank />, { data });
}

describe("Stats tab", () => {
  test("leads with the streak and keeps rank to a single plain row", () => {
    const html = view([2, 1, 0]);
    expect(html).toContain(">3 day streak<");
    expect(html).toContain("You&#x27;re covered for today.");
    expect(html.indexOf("day streak")).toBeLessThan(html.indexOf("Veteran"));
    expect(html).toContain(">Veteran");
    expect(html).toContain("Level 8 of 11");
    expect(html).toContain("to Master");
  });

  test("marks the last seven days, today included", () => {
    const html = view([2, 1, 0]);
    expect(html.match(/week-day is-goal/g)).toHaveLength(3);
    expect(html).toContain("is-today");
    expect(html).toContain(", today: hit the daily goal");
    expect(html).toContain("sheet-flame is-lit");
  });

  test("keeps the flame dark until today reaches the daily goal", () => {
    const html = view([1, 0], 5.2e9, { 0: 100e3 });
    expect(html).toContain(">2 day streak<");
    expect(html).toContain("Covered for today. 400.0K more tokens lights the flame.");
    expect(html).toContain("week-day is-used is-today");
    expect(html).toContain(", today: used a coding tool");
    expect(html).not.toContain("sheet-flame is-lit");
  });

  test("shows a day a freeze covered, and the freezes left", () => {
    const html = view([3, 1, 0], 5.2e9, { 3: 1.1e9 });
    expect(html).toContain(">3 day streak<");
    expect(html.match(/week-day is-frozen/g)).toHaveLength(1);
    expect(html).toContain(": streak freeze used");
    expect(html).toContain("1 ready");
    expect(html).toContain("398.00M to next freeze");
  });

  test("asks for usage today when the streak is only alive from yesterday", () => {
    const html = view([2, 1]);
    expect(html).toContain(">2 day streak<");
    expect(html).toContain("Use a coding tool today to keep it going.");
    expect(html).not.toContain("sheet-flame is-lit");
  });

  test("shows no streak, and a way to start one, with no recent usage", () => {
    const html = view([10, 9]);
    expect(html).toContain(">No streak yet<");
    expect(html).toContain("Use a coding tool today to start a streak.");
    expect(html).toContain("Best: 2 days.");
  });
});

describe("rank names", () => {
  test("are plain, ordered, and carry no taglines", () => {
    expect(TIERS.map((t) => t.title)).toEqual([
      "Newcomer",
      "Explorer",
      "Regular",
      "Builder",
      "Power User",
      "Heavy User",
      "Expert",
      "Veteran",
      "Master",
      "Grandmaster",
      "Legend",
    ]);
    expect(TIERS.every((t) => !("quip" in t))).toBe(true);
  });
});
