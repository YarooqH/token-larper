import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StreakChip } from "./StreakChip.tsx";

const chip = (days: number, doneToday: boolean) =>
  renderToStaticMarkup(<StreakChip streak={{ days, doneToday }} active={false} onOpen={() => {}} />);

describe("header streak chip", () => {
  test("shows only the flame and the day count", () => {
    const html = chip(12, true);
    expect(html).toContain('<span class="streak-chip-days">12</span>');
    expect(html).not.toContain("Lv ");
  });

  test("lights the flame once today has usage", () => {
    expect(chip(12, true)).toContain("is-lit");
    expect(chip(12, false)).not.toContain("is-lit");
    expect(chip(0, false)).not.toContain("is-lit");
  });

  test("says what to do when the streak is at risk or empty", () => {
    expect(chip(12, false)).toContain("12 day streak. Use a coding tool today to keep it.");
    expect(chip(0, false)).toContain("No day streak. Use a coding tool today to start one.");
  });
});
