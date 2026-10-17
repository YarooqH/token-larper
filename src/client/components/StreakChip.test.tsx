import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DayStreak } from "../lib/rank.ts";
import { StreakChip } from "./StreakChip.tsx";

const chip = (days: number, todayTokens: number, freezes = 0) => {
  const streak: DayStreak = {
    days,
    doneToday: todayTokens > 0,
    todayTokens,
    goalMet: todayTokens >= 500e3,
    freezes,
    nextFreezeIn: 100e6,
    frozen: [],
  };
  return renderToStaticMarkup(<StreakChip streak={streak} active={false} onOpen={() => {}} />);
};

describe("header streak chip", () => {
  test("shows only the flame and the day count", () => {
    const html = chip(12, 1e6);
    expect(html).toContain('<span class="streak-chip-days">12</span>');
    expect(html).not.toContain("Lv ");
  });

  test("lights the flame once today reaches the daily goal", () => {
    expect(chip(12, 1e6)).toContain("is-lit");
    expect(chip(12, 1000)).not.toContain("is-lit");
    expect(chip(12, 0)).not.toContain("is-lit");
    expect(chip(0, 0)).not.toContain("is-lit");
  });

  test("fills the flame once today has any usage", () => {
    expect(chip(12, 1000)).toContain('fill="currentColor"');
    expect(chip(12, 0)).toContain('fill="none"');
  });

  test("says what to do when the streak is at risk, short of the goal, or empty", () => {
    expect(chip(12, 0)).toContain("12 day streak. Use a coding tool today to keep it.");
    expect(chip(12, 100e3)).toContain("12 day streak. 400.0K more tokens today to light the flame.");
    expect(chip(0, 0)).toContain("No day streak. Use a coding tool today to start one.");
  });

  test("mentions the freezes ready", () => {
    expect(chip(12, 1e6, 3)).toContain("12 day streak. 3 streak freezes ready.");
    expect(chip(12, 1e6, 1)).toContain("1 streak freeze ready.");
  });
});
