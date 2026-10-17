import React from "react";
import { Flame } from "./Icons.tsx";
import { DAILY_GOAL, type DayStreak } from "../lib/rank.ts";
import { formatCompactNumber } from "../utils.ts";

function describe({ days, doneToday, goalMet, todayTokens, freezes }: DayStreak): string {
  const ready = freezes > 0 ? ` ${freezes} streak ${freezes === 1 ? "freeze" : "freezes"} ready.` : "";
  if (days === 0) return `No day streak. Use a coding tool today to start one.${ready}`;
  const count = `${days} day streak`;
  if (goalMet) return `${count}.${ready}`;
  if (doneToday) return `${count}. ${formatCompactNumber(DAILY_GOAL - todayTokens)} more tokens today to light the flame.${ready}`;
  return `${count}. Use a coding tool today to keep it.${ready}`;
}

/** Day streak in the header, Duolingo-style: a flame and a count. Opens the Stats tab. */
export function StreakChip({ streak, onOpen, active }: { streak: DayStreak; onOpen: () => void; active: boolean }) {
  const label = `${describe(streak)} Open stats.`;
  // An outline while today has no usage, filled once today counts, and in color once
  // today reaches the daily goal, so a streak at risk reads as such.
  const lit = streak.days > 0 && streak.goalMet;
  const safe = streak.days > 0 && streak.doneToday;
  return (
    <button
      type="button"
      className={`streak-chip ${lit ? "is-lit" : ""} ${active ? "is-active" : ""}`}
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      <Flame size={16} aria-hidden="true" fill={safe ? "currentColor" : "none"} />
      <span className="streak-chip-days">{streak.days}</span>
    </button>
  );
}
