import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DashboardPayload, StartupConfig } from "./types.ts";
import { dataPath } from "./paths.ts";
import { dayStreak, rankFor } from "./client/lib/rank.ts";
import { formatCurrency, localDateKey } from "./client/utils.ts";

// Everything the tray shows is formatted here, so the PowerShell script only places
// strings and never needs non-ASCII literals of its own.

const THEME_FILE = dataPath("ui-theme.json");
const THEME_KEYS = ["surface", "text", "text2", "text3", "border", "accent", "accentInk", "gold"] as const;

export type TrayTheme = Record<(typeof THEME_KEYS)[number], string> & { mode: "light" | "dark" };

let theme: TrayTheme | null = loadTheme();

function loadTheme(): TrayTheme | null {
  try {
    return existsSync(THEME_FILE) ? parseTheme(JSON.parse(readFileSync(THEME_FILE, "utf8"))) : null;
  } catch {
    return null;
  }
}

/** Accept only #rrggbb colors; the dashboard resolves every theme color to hex before sending. */
export function parseTheme(value: unknown): TrayTheme | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const out: Partial<TrayTheme> = { mode: source.mode === "light" ? "light" : "dark" };
  for (const key of THEME_KEYS) {
    const color = source[key];
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
    out[key] = color.toLowerCase();
  }
  return out as TrayTheme;
}

export function saveTheme(next: TrayTheme): void {
  theme = next;
  try {
    mkdirSync(dirname(THEME_FILE), { recursive: true });
    writeFileSync(THEME_FILE, JSON.stringify(next), "utf8");
  } catch {
    // The theme still applies for this session.
  }
}

const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 }).format(n);

/** The tray polls this often, but a full ccusage rescan across every harness is heavier than that. */
const TRAY_MAX_AGE_MS = 60_000;
/** The tray gives up on a request after 4 s, so a rescan that is still running is left to finish unawaited. */
const TRAY_REFRESH_WAIT_MS = 2_500;

/**
 * The dashboard payload for the tray. The cache only refreshes when a dashboard tab asks, so with the
 * browser closed it would sit at whatever it held when that tab last synced (and read "no usage yet"
 * all morning). Start a rescan once it is older than a minute, and wait briefly for it.
 */
export async function trayDashboardData(
  read: (options: { refresh: boolean }) => Promise<DashboardPayload>,
  refresh: () => Promise<DashboardPayload>,
  now: number = Date.now(),
): Promise<DashboardPayload> {
  const cached = await read({ refresh: false });
  const age = now - new Date(cached.generatedAt).getTime();
  if (Number.isFinite(age) && age < TRAY_MAX_AGE_MS) return cached;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DashboardPayload>((resolve) => {
    timer = setTimeout(() => resolve(cached), TRAY_REFRESH_WAIT_MS);
  });
  try {
    return await Promise.race([refresh().catch(() => cached), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function buildTrayStatus(data: DashboardPayload, startup: StartupConfig) {
  const today = localDateKey(new Date());
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const since = localDateKey(weekStart);

  const todayRow = data.daily.find((d) => d.period === today);
  const week = data.daily.filter((d) => d.period >= since && d.period <= today);
  const weekTokens = week.reduce((acc, d) => acc + d.totalTokens, 0);
  const weekCost = week.reduce((acc, d) => acc + d.verifiedCost, 0);
  const rank = rankFor(data.totals.totalTokens);
  const streak = dayStreak(data, today);

  const todayTokens = todayRow?.totalTokens ?? 0;
  const todayCost = todayRow?.verifiedCost ?? 0;
  const allTime = `${compact(data.totals.totalTokens)} · ${formatCurrency(data.totals.verifiedCost, 0)}`;
  const syncing = data.syncingHarnesses.length > 0;
  const updated = new Date(data.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return {
    // Popup
    todayTokensText: todayTokens > 0 ? compact(todayTokens) : "0",
    todayCaptionText: todayTokens > 0 ? "Today" : "Today · no usage yet",
    todayCostText: formatCurrency(todayCost),
    weekText: `${compact(weekTokens)} · ${formatCurrency(weekCost)}`,
    allTimeText: allTime,
    streakText: streak.days > 0 ? `${streak.days} day streak` : "No streak",
    // Lit once today has usage; dim while the streak still needs today (or there is none).
    streakActive: streak.days > 0 && streak.doneToday,
    updatedText: syncing ? "Syncing…" : `Updated ${updated}`,
    theme,
    // Menu and tooltip
    summaryText: `Today ${compact(todayTokens)} · ${formatCurrency(todayCost)}   All time ${allTime}`,
    shortTooltip: `today ${compact(todayTokens)} · ${formatCurrency(todayCost)}`,
    // Older tray scripts read these; keep them until every running tray has restarted.
    levelText: `Lv ${rank.tier.level}`,
    levelTitle: rank.tier.title,
    totalTokensText: compact(data.totals.totalTokens),
    verifiedCostText: formatCurrency(data.totals.verifiedCost),
    estimatedCostText: formatCurrency(data.totals.estimatedCost),
    bootEnabled: startup.enabled,
    openBrowserOnBoot: startup.openBrowserOnBoot,
  };
}
