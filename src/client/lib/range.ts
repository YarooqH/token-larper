import { localDateKey } from "../utils.ts";

export type RangePreset = "7d" | "30d" | "90d" | "month" | "last-month" | "year" | "all" | "custom";

/** An inclusive span of local calendar days, as YYYY-MM-DD keys. */
export interface DateRange {
  preset: RangePreset;
  start: string;
  end: string;
}

export const RANGE_PRESETS: { id: Exclude<RangePreset, "custom">; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
];

export function parseDay(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

export function addDays(key: string, n: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return localDateKey(d);
}

export function daysInRange(start: string, end: string): number {
  return Math.round((parseDay(end).getTime() - parseDay(start).getTime()) / 86_400_000) + 1;
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let key = start; key <= end; key = addDays(key, 1)) days.push(key);
  return days;
}

export function todayKey(): string {
  return localDateKey(new Date());
}

/** Resolve a preset against today. "All time" starts at the first day with any usage. */
export function presetRange(preset: Exclude<RangePreset, "custom">, firstDay: string | undefined): DateRange {
  const end = todayKey();
  const today = parseDay(end);
  let start = end;
  let last = end;
  if (preset === "7d") start = addDays(end, -6);
  else if (preset === "30d") start = addDays(end, -29);
  else if (preset === "90d") start = addDays(end, -89);
  else if (preset === "month") start = localDateKey(new Date(today.getFullYear(), today.getMonth(), 1));
  else if (preset === "last-month") {
    start = localDateKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    last = localDateKey(new Date(today.getFullYear(), today.getMonth(), 0));
  } else if (preset === "year") start = `${today.getFullYear()}-01-01`;
  else start = firstDay && firstDay < end ? firstDay : end;
  return { preset, start, end: last };
}

/** The span of equal length immediately before this one, for period-over-period deltas. */
export function previousRange(range: DateRange): { start: string; end: string; days: number } | null {
  if (range.preset === "all") return null;
  const days = daysInRange(range.start, range.end);
  return { start: addDays(range.start, -days), end: addDays(range.start, -1), days };
}

export function rangeLabel(range: DateRange): string {
  return RANGE_PRESETS.find((p) => p.id === range.preset)?.label ?? "Custom range";
}

export function formatDay(key: string, withYear = false): string {
  return parseDay(key).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function formatSpan(start: string, end: string): string {
  if (start === end) return formatDay(start, true);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDay(start, !sameYear)} – ${formatDay(end, true)}`;
}
