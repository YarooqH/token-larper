import React from "react";
import { Flame } from "./Icons.tsx";
import type { DayStreak } from "../lib/rank.ts";

function describe({ days, doneToday }: DayStreak): string {
  if (days === 0) return "No day streak. Use a coding tool today to start one.";
  const count = `${days} day streak`;
  return doneToday ? `${count}.` : `${count}. Use a coding tool today to keep it.`;
}

/** Day streak in the header, Duolingo-style: a flame and a count. Opens the Stats tab. */
export function StreakChip({ streak, onOpen, active }: { streak: DayStreak; onOpen: () => void; active: boolean }) {
  const label = `${describe(streak)} Open stats.`;
  // The flame is filled once today counts; until then it's an outline, so a streak at risk reads as such.
  const lit = streak.days > 0 && streak.doneToday;
  return (
    <button
      type="button"
      className={`streak-chip ${lit ? "is-lit" : ""} ${active ? "is-active" : ""}`}
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      <Flame size={16} aria-hidden="true" fill={lit ? "currentColor" : "none"} />
      <span className="streak-chip-days">{streak.days}</span>
    </button>
  );
}
