import type { DashboardPayload, HarnessId, TimePeriodRow } from "../../types.ts";
import { formatCompactNumber, formatCurrency, localDateKey } from "../utils.ts";
import { addDays, formatDay, formatSpan, parseDay, todayKey } from "./range.ts";

// Everything on the Rank tab is lifetime and computed from data the dashboard already
// has; filters never change it. Sessions can stay open for weeks (Antigravity keeps one
// conversation going for months), so records and badges are built from days, not sessions.

// ---------- Tiers ----------

export interface Tier {
  level: number;
  min: number;
  title: string;
  quip: string;
}

const TIER_LIST: [number, string, string][] = [
  [0, "Free-Tier Tourist", "Barely warming up the GPU rack."],
  [1e6, "Prompt Apprentice", "Still reads stack traces by hand."],
  [10e6, "Context Goblin", "Stuffs whole files into the prompt like a raccoon at a buffet."],
  [50e6, "Prompt Warlock", "Why write a five-line script when 40M tokens can do it?"],
  [250e6, "Context Window Whale", "Their ~/.claude folder has its own gravitational field."],
  [1e9, "Arch-Duke of Token Burn", "A billion tokens incinerated for one quick refactor."],
  [2.5e9, "Giga-Token Sovereign", "Keeps an H100 warm at all times."],
  [5e9, "Cache Lich", "No longer writes code. Summons it."],
  [10e9, "Datacenter Warlord", "The utility company knows them by name."],
  [25e9, "GPU Emperor", "Export controls were written with them in mind."],
  [100e9, "The Final Boss of Inference", "There is nothing left to rank. Go outside."],
];

export const TIERS: Tier[] = TIER_LIST.map(([min, title, quip], i) => ({ level: i + 1, min, title, quip }));

export interface RankState {
  tier: Tier;
  next: Tier | null;
  /** 0–100 progress from this tier's floor to the next tier's. */
  progress: number;
  toNext: number;
}

export function rankFor(tokens: number): RankState {
  let index = 0;
  TIERS.forEach((t, i) => {
    if (tokens >= t.min) index = i;
  });
  const tier = TIERS[index]!;
  const next = TIERS[index + 1] ?? null;
  const progress = next ? Math.min(100, ((tokens - tier.min) / (next.min - tier.min)) * 100) : 100;
  return { tier, next, progress, toNext: next ? next.min - tokens : 0 };
}

// ---------- Rivals ----------

export interface Rival {
  tokens: number;
  name: string;
  blurb: string;
}

/** Made-up opponents at lifetime-token milestones. */
export const RIVALS: Rival[] = [
  { tokens: 2e6, name: "A curious intern", blurb: "Asked it for a haiku, once." },
  { tokens: 8e6, name: "A weekend side project", blurb: "Still almost done." },
  { tokens: 25e6, name: "The coworker who pastes into a chat window", blurb: "Copy, paste, repeat." },
  { tokens: 60e6, name: "A hackathon team at 4am", blurb: "Twelve energy drinks, one demo." },
  { tokens: 150e6, name: "A Discord bot with feelings", blurb: "Remembers everyone's birthday." },
  { tokens: 400e6, name: "A SaaS support bot", blurb: "Has tried turning it off and on." },
  { tokens: 800e6, name: "An agency selling AI transformation", blurb: "Bills by the slide." },
  { tokens: 1.6e9, name: "A startup's entire demo day", blurb: "Pivoted to agents mid-pitch." },
  { tokens: 3e9, name: "A CI pipeline that runs agents on every commit", blurb: "Nobody knows how to turn it off." },
  { tokens: 6e9, name: "A Series A company that is basically a wrapper", blurb: "The wrapper has a wrapper." },
  { tokens: 12e9, name: "An AI lab's intern cluster", blurb: "Unsupervised since March." },
  { tokens: 30e9, name: "A frontier lab's eval suite", blurb: "Grades itself generously." },
  { tokens: 75e9, name: "Every autocomplete in a Fortune 500", blurb: "Suggesting “Dear Sir or Madam”." },
  { tokens: 200e9, name: "The internet's reply guys, combined", blurb: "Actually, …" },
  { tokens: 1e12, name: "A sentient spreadsheet", blurb: "Has opinions about your formulas." },
];

export function nextRival(tokens: number): Rival | null {
  return RIVALS.find((r) => r.tokens > tokens) ?? null;
}

export function lastDefeated(tokens: number): Rival | null {
  return [...RIVALS].reverse().find((r) => r.tokens <= tokens) ?? null;
}

// ---------- Lifetime stats ----------

export interface Streak {
  days: number;
  start: string;
  end: string;
}

export interface LifetimeStats {
  tokens: number;
  verifiedCost: number;
  estimatedCost: number;
  activeDays: number;
  days: TimePeriodRow[];
  longestStreak: Streak | null;
  currentStreak: Streak | null;
  biggestDay: TimePeriodRow | null;
  priciestDay: TimePeriodRow | null;
  topTool: { id: HarnessId; tokens: number } | null;
  toolCount: number;
  topModel: string | null;
  modelCount: number;
  topProject: { name: string; tokens: number } | null;
  lateNightSessions: number;
  cacheRate: number;
}

function maxBy<T>(items: T[], score: (t: T) => number): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

function hourOf(iso: string | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}

/** "Sep 14 – Sep 20, 2026" for the Monday-first week containing a day. */
export function weekSpan(day: string): string {
  const monday = addDays(day, -((parseDay(day).getDay() + 6) % 7));
  return formatSpan(monday, addDays(monday, 6));
}

/** Days with any usage, oldest first. */
function activeDaysOf(data: DashboardPayload): TimePeriodRow[] {
  return data.daily.filter((d) => d.totalTokens > 0).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Consecutive-day runs over sorted active days. A run still counts as current when its
 * last day is yesterday: today isn't over, so the streak is alive until it's missed.
 */
function streaksOf(days: TimePeriodRow[], today: string): { longest: Streak | null; current: Streak | null } {
  let longest: Streak | null = null;
  let run: Streak | null = null;
  for (const d of days) {
    const prev: Streak | null = run;
    const next: Streak =
      prev && addDays(prev.end, 1) === d.period
        ? { days: prev.days + 1, start: prev.start, end: d.period }
        : { days: 1, start: d.period, end: d.period };
    run = next;
    if (!longest || next.days > longest.days) longest = next;
  }
  const last: Streak | null = run;
  const current = last && (last.end === today || last.end === addDays(today, -1)) ? last : null;
  return { longest, current };
}

export interface DayStreak {
  /** Consecutive active days ending today, or yesterday if today has no usage yet. */
  days: number;
  /** Whether today already has usage, so the streak is safe for the day. */
  doneToday: boolean;
}

/** The streak shown in the header and the tray popup. */
export function dayStreak(data: DashboardPayload, today: string = todayKey()): DayStreak {
  const days = activeDaysOf(data);
  return {
    days: streaksOf(days, today).current?.days ?? 0,
    doneToday: days.some((d) => d.period === today),
  };
}

export function lifetimeStats(data: DashboardPayload): LifetimeStats {
  const days = activeDaysOf(data);
  const { longest, current } = streaksOf(days, todayKey());

  const projects = new Map<string, { name: string; tokens: number }>();
  for (const s of data.sessions) {
    if (!s.projectRoot) continue;
    const p = projects.get(s.projectRoot) ?? { name: s.projectName ?? s.projectRoot, tokens: 0 };
    p.tokens += s.totalTokens;
    projects.set(s.projectRoot, p);
  }

  const hours = data.sessions.map((s) => [hourOf(s.firstActivity), hourOf(s.lastActivity)].filter((h): h is number => h !== null));
  const timed = hours.filter((h) => h.length > 0);
  const lateNight = timed.filter((h) => h.some((x) => x >= 2 && x < 5)).length;

  const prompt = days.reduce((acc, d) => acc + d.inputTokens + d.cacheReadTokens + d.cacheCreationTokens, 0);
  const cacheRead = days.reduce((acc, d) => acc + d.cacheReadTokens, 0);
  const topTool = maxBy(data.harnesses, (h) => h.totalTokens);

  return {
    tokens: data.totals.totalTokens,
    verifiedCost: data.totals.verifiedCost,
    estimatedCost: data.totals.estimatedCost,
    activeDays: days.length,
    days,
    longestStreak: longest,
    currentStreak: current,
    biggestDay: maxBy(days, (d) => d.totalTokens),
    priciestDay: maxBy(days, (d) => d.verifiedCost),
    topTool: topTool && topTool.totalTokens > 0 ? { id: topTool.meta.id, tokens: topTool.totalTokens } : null,
    toolCount: data.harnesses.filter((h) => h.meta.hasUsage).length,
    topModel: maxBy(data.models, (m) => m.totalTokens)?.modelName ?? null,
    modelCount: new Set(data.models.map((m) => m.modelName)).size,
    topProject: maxBy([...projects.values()], (p) => p.tokens),
    lateNightSessions: lateNight,
    cacheRate: prompt > 0 ? (cacheRead / prompt) * 100 : 0,
  };
}

// ---------- Achievements ----------

export interface Achievement {
  id: string;
  name: string;
  requirement: string;
  earned: boolean;
  /** When earned: what earned it. */
  detail?: string;
  progress: { current: number; target: number; label: string };
}

function isoWeekKey(day: string): string {
  const d = parseDay(day);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDateKey(monday);
}

export function achievements(data: DashboardPayload, stats: LifetimeStats): Achievement[] {
  const list: Achievement[] = [];
  const add = (
    id: string,
    name: string,
    requirement: string,
    current: number,
    target: number,
    fmt: (n: number) => string,
    detail?: string
  ) =>
    list.push({
      id,
      name,
      requirement,
      earned: current >= target,
      detail: current >= target ? detail : undefined,
      progress: { current: Math.min(current, target), target, label: `${fmt(Math.min(current, target))} / ${fmt(target)}` },
    });
  // Three significant digits reads cleaner in "206M / 500M" than the dashboard's fixed decimals.
  const tokens = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 }).format(n);
  const count = (n: number) => String(Math.round(n));
  const dayOf = (d: TimePeriodRow | null) => (d ? formatDay(d.period, true) : undefined);

  add("billion", "Billionaire", "Burn 1B lifetime tokens.", stats.tokens, 1e9, tokens, `${tokens(stats.tokens)} lifetime`);
  add("ten-billion", "Ten Billion Club", "Burn 10B lifetime tokens.", stats.tokens, 10e9, tokens, `${tokens(stats.tokens)} lifetime`);

  const streak = stats.longestStreak?.days ?? 0;
  const streakSpan = stats.longestStreak ? formatSpan(stats.longestStreak.start, stats.longestStreak.end) : undefined;
  add("streak-7", "Streak Keeper", "Use a coding agent 7 days in a row.", streak, 7, count, streakSpan);
  add("streak-30", "Iron Streak", "Use a coding agent 30 days in a row.", streak, 30, count, streakSpan);

  add("night-owl", "Night Owl", "Ten sessions still running between 2 and 5am.", stats.lateNightSessions, 10, count, `${stats.lateNightSessions} sessions`);

  const toolsDay = maxBy(stats.days, (d) => Object.keys(d.byHarness).length);
  const toolsMax = toolsDay ? Object.keys(toolsDay.byHarness).length : 0;
  add("polyglot", "Polyglot", "Use 5 different coding tools in one day.", toolsMax, 5, count, dayOf(toolsDay));

  add("whale", "Whale Day", "Burn 100M tokens in one day.", stats.biggestDay?.totalTokens ?? 0, 100e6, tokens, dayOf(stats.biggestDay));
  add("leviathan", "Leviathan", "Burn 500M tokens in one day.", stats.biggestDay?.totalTokens ?? 0, 500e6, tokens, dayOf(stats.biggestDay));
  add("big-spender", "Big Spender", "Spend $50 of verified cost in one day.", stats.priciestDay?.verifiedCost ?? 0, 50, (n) => formatCurrency(n, 0), dayOf(stats.priciestDay));

  // Cheapest big day: 10M+ tokens for under $1 (free and cheap models count).
  const cheap = stats.days.filter((d) => d.totalTokens >= 10e6 && d.verifiedCost < 1);
  add("free-lunch", "Free Lunch", "Burn 10M tokens in a day for under $1.", cheap.length ? 1 : 0, 1, (n) => (n ? "done" : "not yet"), cheap[0] ? dayOf(cheap[0]) : undefined);

  const weekends = new Map<string, number>();
  for (const d of stats.days) {
    const dow = parseDay(d.period).getDay();
    if (dow !== 0 && dow !== 6) continue;
    const saturday = dow === 6 ? d.period : addDays(d.period, -1);
    weekends.set(saturday, (weekends.get(saturday) ?? 0) + d.totalTokens);
  }
  const weekend = maxBy([...weekends.entries()], ([, t]) => t);
  add("weekend", "Weekend Warrior", "Burn 250M tokens over one weekend.", weekend?.[1] ?? 0, 250e6, tokens, weekend ? `Weekend of ${formatDay(weekend[0], true)}` : undefined);

  const weeks = new Map<string, { input: number; read: number; write: number; days: number }>();
  for (const d of stats.days) {
    const k = isoWeekKey(d.period);
    const w = weeks.get(k) ?? { input: 0, read: 0, write: 0, days: 0 };
    w.input += d.inputTokens;
    w.read += d.cacheReadTokens;
    w.write += d.cacheCreationTokens;
    w.days += 1;
    weeks.set(k, w);
  }
  const cacheWeek = maxBy(
    [...weeks.entries()].filter(([, w]) => w.days >= 3).map(([k, w]) => ({ k, rate: (w.read / Math.max(1, w.input + w.read + w.write)) * 100 })),
    (w) => w.rate
  );
  add("cache-goblin", "Cache Goblin", "A week (3+ active days) with 97% of prompt tokens from cache.", cacheWeek?.rate ?? 0, 97, (n) => `${n.toFixed(1)}%`, cacheWeek ? weekSpan(cacheWeek.k) : undefined);

  const hops = new Map<string, Set<string>>();
  for (const s of data.sessions) {
    if (!s.projectRoot || s.date === "Unknown") continue;
    const k = isoWeekKey(s.date);
    hops.set(k, (hops.get(k) ?? new Set<string>()).add(s.projectRoot));
  }
  const hopWeek = maxBy([...hops.entries()], ([, r]) => r.size);
  add("hopper", "Project Hopper", "Work in 10 repositories in one week.", hopWeek?.[1].size ?? 0, 10, count, hopWeek ? weekSpan(hopWeek[0]) : undefined);

  add("collector", "Model Collector", "Use 75 different models.", stats.modelCount, 75, count, `${stats.modelCount} models`);

  const months = new Map<string, Map<string, number>>();
  for (const d of stats.days) {
    const m = months.get(d.period.slice(0, 7)) ?? new Map<string, number>();
    for (const hb of Object.values(d.byHarness)) for (const mm of hb.models) m.set(mm.modelName, (m.get(mm.modelName) ?? 0) + mm.totalTokens);
    months.set(d.period.slice(0, 7), m);
  }
  const loyal = maxBy(
    [...months.entries()]
      .map(([month, models]) => {
        const total = [...models.values()].reduce((a, b) => a + b, 0);
        const top = maxBy([...models.entries()], ([, t]) => t);
        return { month, total, model: top?.[0] ?? "", share: total > 0 && top ? (top[1] / total) * 100 : 0 };
      })
      .filter((m) => m.total >= 10e6),
    (m) => m.share
  );
  add(
    "loyalist",
    "Loyalist",
    "A month where one model did 90% of the work.",
    loyal?.share ?? 0,
    90,
    (n) => `${Math.round(n)}%`,
    loyal ? `${loyal.model}, ${parseDay(`${loyal.month}-01`).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : undefined
  );

  return list;
}
