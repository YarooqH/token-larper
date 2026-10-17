import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HarnessId } from "./types.ts";
import { dataPath } from "./paths.ts";

// ccusage only sees the logs a tool still keeps in a format it can read. When a tool
// prunes, moves or compresses old logs (Codex started compressing them to .jsonl.zst),
// those days drop out of its report, which shrinks lifetime totals and breaks day
// streaks. Every day row ccusage has reported is kept here, so a day stays counted once
// it has been seen.

const HISTORY_FILE = dataPath("daily-history.json");

type DayRow = Record<string, any>;

let history: Map<HarnessId, Map<string, DayRow>> | null = null;
let dirty = false;

function rowTokens(row: DayRow): number {
  return (
    Number(row.totalTokens || 0) ||
    Number(row.inputTokens || 0) + Number(row.outputTokens || 0) + Number(row.cacheCreationTokens || 0) + Number(row.cacheReadTokens || 0)
  );
}

/**
 * Fresh rows win, except where the kept row for the same day has more tokens: a day's
 * usage only grows, so fewer tokens means some of that day's logs went missing. Days
 * only in the kept rows are added back. Sorted by date.
 */
export function mergeDailyRows(fresh: DayRow[], kept: DayRow[]): DayRow[] {
  const byDate = new Map<string, DayRow>();
  for (const row of kept) if (row?.date) byDate.set(String(row.date), row);
  for (const row of fresh) {
    if (!row?.date) continue;
    const date = String(row.date);
    const old = byDate.get(date);
    if (!old || rowTokens(row) >= rowTokens(old)) byDate.set(date, row);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

function load(): Map<HarnessId, Map<string, DayRow>> {
  if (history) return history;
  history = new Map();
  try {
    const saved = JSON.parse(readFileSync(HISTORY_FILE, "utf8")) as Record<string, DayRow[]>;
    for (const [harness, rows] of Object.entries(saved)) {
      if (Array.isArray(rows)) history.set(harness as HarnessId, new Map(rows.map((r) => [String(r.date), r])));
    }
  } catch {
    // First run or a damaged file: history starts from the next report.
  }
  return history;
}

/** A harness's day rows merged with every day seen before; remembers the result. */
export function withDailyHistory(harness: HarnessId, fresh: DayRow[]): DayRow[] {
  const store = load();
  const kept = store.get(harness);
  const merged = mergeDailyRows(fresh, kept ? [...kept.values()] : []);
  // Each report parses into new objects, so compare contents to skip rewriting an unchanged file.
  const changed =
    !kept ||
    merged.length !== kept.size ||
    merged.some((row) => JSON.stringify(kept.get(String(row.date))) !== JSON.stringify(row));
  if (changed) {
    store.set(harness, new Map(merged.map((r) => [String(r.date), r])));
    dirty = true;
  }
  return merged;
}

export function saveDailyHistory(): void {
  if (!dirty || !history) return;
  dirty = false;
  const out = Object.fromEntries([...history].map(([harness, rows]) => [harness, [...rows.values()]]));
  try {
    mkdirSync(dirname(HISTORY_FILE), { recursive: true });
    writeFileSync(HISTORY_FILE, JSON.stringify(out), "utf8");
  } catch {
    // Kept in memory for this run; the next save tries again.
    dirty = true;
  }
}
