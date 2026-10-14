import React, { useEffect, useMemo, useState } from "react";
import type { HarnessLimitCard, LimitsPayload, QuotaWindow } from "../../types.ts";
import { AlertTriangle, ArrowUpRight, Clock, Coins, Gauge, Info, RefreshCw } from "../components/Icons.tsx";
import { ToolMark } from "../components/ToolMark.tsx";
import { useDashboard } from "../context.tsx";
import { Segmented } from "./Overview.tsx";

export type LimitsFilter = "all" | "attention" | "live" | "local";
export type QuotaDisplayMode = "remaining" | "used";

/** The strip on Overview / Tools shows this many plans; the rest sit behind "+N more". */
const STRIP_MAX = 6;
/** A payload older than this means polling is failing or paused, so say so next to "Checked". */
const PAYLOAD_OLD_MS = 3 * 60_000;

type CardCredit = NonNullable<HarnessLimitCard["credits"]>[number];

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Clamps to 0..100; NaN, undefined and infinities become 0 so a bad value never breaks a bar. */
export function clampPercent(value: number | null | undefined): number {
  return finite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/** Whole-number percent text that never rounds a non-empty quota up to 100 or an empty one down to 0. */
export function formatPercent(value: number | null | undefined): string {
  const v = clampPercent(value);
  const rounded = Math.round(v);
  if (rounded === 0 && v > 0) return "<1";
  if (rounded === 100 && v < 100) return "99";
  return String(rounded);
}

/** Remaining and used share of a window. `known` is false when the provider sent neither as a number. */
export function windowPercents(win: Pick<QuotaWindow, "remainingPercent" | "usedPercent">): {
  remaining: number;
  used: number;
  known: boolean;
} {
  const hasRemaining = finite(win.remainingPercent);
  const hasUsed = finite(win.usedPercent);
  if (!hasRemaining && !hasUsed) return { remaining: 0, used: 0, known: false };
  const remaining = hasRemaining ? clampPercent(win.remainingPercent) : 100 - clampPercent(win.usedPercent);
  const used = hasUsed ? clampPercent(win.usedPercent) : 100 - remaining;
  return { remaining, used, known: true };
}

/** Formats a future ISO reset time into a human countdown (e.g. "3h 47m", "4d 19h", "18m"). */
export function formatResetCountdown(resetsAt: string | null | undefined, nowMs = Date.now()): string | null {
  if (!resetsAt) return null;
  const targetMs = Date.parse(resetsAt);
  if (!Number.isFinite(targetMs)) return null;
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return "Resetting now";

  const totalMinutes = Math.ceil(diffMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remMinutes > 0 ? `${totalHours}h ${remMinutes}m` : `${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

const RESETTING_NOW = "Resetting now";

/** "Resets in 3h 12m", or "Resetting now" when the countdown has run out. */
export function describeReset(countdown: string): string {
  return countdown === RESETTING_NOW ? RESETTING_NOW : `Resets in ${countdown}`;
}

export function formatResetClock(resetsAt: string | null | undefined, nowMs = Date.now()): string | null {
  if (!resetsAt) return null;
  const targetMs = Date.parse(resetsAt);
  if (!Number.isFinite(targetMs)) return null;
  const d = new Date(targetMs);
  const diffHours = (targetMs - nowMs) / 3_600_000;
  if (diffHours <= 24) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "just now", "12m ago", "3h ago", "2d ago" for a past ISO time; null when the time is missing or invalid. */
export function formatAge(iso: string | null | undefined, nowMs = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.floor(Math.max(0, nowMs - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Calculates how far through a rolling window we are (0..100% remaining time) when both
 * resetsAt and windowSeconds are known, so the bar can show a subtle linear-pace marker.
 */
export function computeWindowTimeRemainingPercent(
  win: Pick<QuotaWindow, "resetsAt" | "windowSeconds">,
  nowMs = Date.now(),
): number | null {
  if (!win.resetsAt || !win.windowSeconds || win.windowSeconds <= 0) return null;
  const resetMs = Date.parse(win.resetsAt);
  if (!Number.isFinite(resetMs)) return null;
  const remSeconds = (resetMs - nowMs) / 1000;
  if (remSeconds <= 0 || remSeconds > win.windowSeconds) return null;
  return Math.max(0, Math.min(100, Math.round((remSeconds / win.windowSeconds) * 1000) / 10));
}

/** Shortest window first (5-hour before weekly); windows with no known length keep their order at the end. */
export function sortWindows(windows: QuotaWindow[]): QuotaWindow[] {
  const length = (w: QuotaWindow) => (finite(w.windowSeconds) && w.windowSeconds > 0 ? w.windowSeconds : Infinity);
  return windows
    .map((win, index) => ({ win, index }))
    .sort((a, b) => {
      const la = length(a.win);
      const lb = length(b.win);
      if (la !== lb) return la < lb ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.win);
}

/** A card with an error and nothing to show: the provider could not be read at all. */
export function isUnavailable(card: HarnessLimitCard): boolean {
  return card.windows.length === 0 && !!card.error;
}

export function cardNeedsAttention(card: HarnessLimitCard): boolean {
  return isUnavailable(card) || card.windows.some((w) => w.status === "warning" || w.status === "critical");
}

function attentionRank(card: HarnessLimitCard): number {
  if (card.windows.some((w) => w.status === "critical")) return 0;
  if (isUnavailable(card)) return 1;
  if (card.windows.some((w) => w.status === "warning")) return 2;
  return 3;
}

/** Cards that need attention first, then live before local, then by name so the order never shuffles. */
export function sortCards(cards: HarnessLimitCard[]): HarnessLimitCard[] {
  return [...cards].sort(
    (a, b) =>
      attentionRank(a) - attentionRank(b) ||
      (a.source === b.source ? 0 : a.source === "live" ? -1 : 1) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id),
  );
}

/** Picks the most urgent or primary window for a harness card (for summary strip & KPIs). */
export function pickPrimaryWindow(card: HarnessLimitCard): QuotaWindow | null {
  const windows = sortWindows(card.windows);
  if (windows.length === 0) return null;
  // The tightest window wins when anything is flagged or nearly out; otherwise the shortest window leads.
  let tightest: QuotaWindow | null = null;
  for (const win of windows) {
    const { remaining } = windowPercents(win);
    const urgent = win.status === "warning" || win.status === "critical" || remaining <= 20;
    if (urgent && (!tightest || remaining < windowPercents(tightest).remaining)) tightest = win;
  }
  return tightest ?? windows[0]!;
}

/** Text that backs up the colour of a non-ok window; null when the window is healthy. */
export function windowStatusText(win: Pick<QuotaWindow, "status" | "remainingPercent" | "usedPercent">): string | null {
  if (win.status === "critical") return windowPercents(win).remaining <= 0 ? "Limit reached" : "Critical";
  if (win.status === "warning") return "Running low";
  return null;
}

function windowTone(win: Pick<QuotaWindow, "status">): "ok" | "warning" | "critical" {
  return win.status === "critical" || win.status === "warning" ? win.status : "ok";
}

function windowBarColor(brandColor: string, status: QuotaWindow["status"]): string {
  if (status === "critical") return "var(--error-text)";
  if (status === "warning") return "var(--gold)";
  return brandColor;
}

/** Bar width that keeps a non-empty quota visible as a sliver. */
function barWidth(percent: number): string {
  return `${percent > 0 ? Math.max(2, percent) : 0}%`;
}

/** Every credit bucket across all cards, in card order. */
export function collectCredits(items: HarnessLimitCard[]): { card: HarnessLimitCard; credit: CardCredit }[] {
  return items.flatMap((card) => (card.credits ?? []).map((credit) => ({ card, credit })));
}

/** The bucket that matters most: the one expiring soonest, else the first listed. */
export function pickHeadlineCredit<T extends { credit: CardCredit }>(entries: T[], nowMs = Date.now()): T | null {
  let soonest: { entry: T; ms: number } | null = null;
  for (const entry of entries) {
    const ms = entry.credit.resetsAt ? Date.parse(entry.credit.resetsAt) : NaN;
    if (Number.isFinite(ms) && ms > nowMs && (!soonest || ms < soonest.ms)) soonest = { entry, ms };
  }
  return soonest?.entry ?? entries[0] ?? null;
}

/** Ticks every 30s so countdowns stay current; `initial` pins the first render for tests. */
function useNow(initial?: number): number {
  const [nowMs, setNowMs] = useState(() => initial ?? Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return nowMs;
}

function StatusTag({ text, status }: { text: string; status: "warning" | "critical" }) {
  return (
    <span className={`limit-status-tag is-${status}`}>
      <AlertTriangle size={12} aria-hidden="true" />
      {text}
    </span>
  );
}

/**
 * Compact horizontal strip shown on Overview / Tools so users can see their remaining
 * subscription fuel at a glance and jump straight to the full Limits view.
 */
export function LimitsSummaryStrip({
  limits,
  onOpenLimits,
  now,
}: {
  limits: LimitsPayload | null | undefined;
  onOpenLimits: () => void;
  /** Fixes the clock for the first render (tests). */
  now?: number;
}) {
  const nowMs = useNow(now);
  const cards = useMemo(() => sortCards(limits?.items ?? []), [limits]);

  if (cards.length === 0) return null;

  const shown = cards.slice(0, STRIP_MAX);
  const hidden = cards.length - shown.length;

  return (
    <section className="panel limits-strip" aria-label="Remaining subscription quotas">
      <div className="limits-strip-head">
        <div className="limits-strip-title">
          <Gauge size={15} aria-hidden="true" />
          <strong>Remaining quota</strong>
          <span className="muted">
            {cards.length} {cards.length === 1 ? "plan" : "plans"}, most urgent first
          </span>
        </div>
        <button type="button" className="limits-strip-link" onClick={onOpenLimits}>
          <span>All limits</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="limits-strip-grid">
        {shown.map((card) => (
          <MiniCard key={card.id} card={card} nowMs={nowMs} onOpen={onOpenLimits} />
        ))}
        {hidden > 0 && (
          <button type="button" className="limits-mini-card is-more" onClick={onOpenLimits}>
            +{hidden} more {hidden === 1 ? "plan" : "plans"}
          </button>
        )}
      </div>
    </section>
  );
}

function MiniCard({ card, nowMs, onOpen }: { card: HarnessLimitCard; nowMs: number; onOpen: () => void }) {
  const { seriesOf } = useDashboard();
  const brandColor = seriesOf(card.harness).color;
  const primary = pickPrimaryWindow(card);
  const tool = (
    <span className="limits-mini-tool">
      <ToolMark harness={card.harness} name={card.name} color={brandColor} size={15} decorative />
      <strong>{card.name}</strong>
    </span>
  );

  if (!primary) {
    const failed = !!card.error;
    return (
      <button type="button" className={`limits-mini-card ${failed ? "is-error" : "is-empty"}`} onClick={onOpen}>
        <div className="limits-mini-top">
          {tool}
          <span className="limits-mini-flag">
            <AlertTriangle size={12} aria-hidden="true" />
            {failed ? "Needs attention" : "No data"}
          </span>
        </div>
        <p className="limits-mini-msg">{card.error ?? "No quota windows reported yet."}</p>
      </button>
    );
  }

  const { remaining, known } = windowPercents(primary);
  const statusText = windowStatusText(primary);
  const countdown = formatResetCountdown(primary.resetsAt, nowMs);
  const staleAge = card.stale ? formatAge(card.staleSince, nowMs) : null;
  const detail = card.stale
    ? `Stale${staleAge ? ` · ${staleAge}` : ""}`
    : countdown
    ? describeReset(countdown)
    : primary.remainingValueText ?? card.planName ?? "";

  return (
    <button
      type="button"
      className={`limits-mini-card is-${windowTone(primary)}${card.stale ? " is-stale" : ""}`}
      onClick={onOpen}
    >
      <div className="limits-mini-top">
        {tool}
        <span className="limits-mini-pct">
          {statusText && (
            <>
              <AlertTriangle size={13} aria-hidden="true" />
              <span className="sr-only">{statusText}: </span>
            </>
          )}
          {known ? `${formatPercent(remaining)}% left` : "No data"}
        </span>
      </div>
      <div className="limits-mini-bar" aria-hidden="true">
        <span style={{ width: barWidth(remaining), background: windowBarColor(brandColor, primary.status) }} />
      </div>
      <div className="limits-mini-meta">
        <span title={primary.label}>{primary.label}</span>
        <span>{detail}</span>
      </div>
    </button>
  );
}

const FILTER_LABELS: Record<LimitsFilter, string> = {
  all: "All plans",
  attention: "Attention",
  live: "Live API",
  local: "Local ledger",
};

const DISPLAY_OPTIONS: { id: QuotaDisplayMode; label: string }[] = [
  { id: "remaining", label: "Remaining %" },
  { id: "used", label: "Used %" },
];

export function Limits({
  limits,
  refreshing,
  onRefresh,
  error,
  now,
}: {
  limits: LimitsPayload | null | undefined;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** The last fetch failed; shown as a notice over stale data, or as the whole state when there is none. */
  error?: string | null;
  /** Fixes the clock for the first render (tests). */
  now?: number;
}) {
  const [filter, setFilter] = useState<LimitsFilter>("all");
  const [displayMode, setDisplayMode] = useState<QuotaDisplayMode>("remaining");
  const nowMs = useNow(now);

  // The Limits tab ignores the global tool filter: its picker is hidden here, so a filter set
  // elsewhere would leave a shortened list with no way to clear it.
  const allItems = limits?.items ?? [];

  const attentionCount = useMemo(() => allItems.filter(cardNeedsAttention).length, [allItems]);

  const filteredItems = useMemo(() => {
    const matching = allItems.filter((item) => {
      if (filter === "live" && item.source !== "live") return false;
      if (filter === "local" && item.source !== "local") return false;
      if (filter === "attention" && !cardNeedsAttention(item)) return false;
      return true;
    });
    return sortCards(matching);
  }, [allItems, filter]);

  // Summary metrics across all connected subscriptions. Cards with no windows contribute nothing here.
  const summary = useMemo(() => {
    const liveCount = allItems.filter((i) => i.source === "live").length;
    const localCount = allItems.filter((i) => i.source === "local").length;
    const unavailableCount = allItems.filter(isUnavailable).length;

    let tightest: { card: HarnessLimitCard; win: QuotaWindow; remaining: number; used: number } | null = null;
    let soonestReset: { card: HarnessLimitCard; win: QuotaWindow; resetMs: number } | null = null;

    for (const card of sortCards(allItems)) {
      for (const win of sortWindows(card.windows)) {
        const pct = windowPercents(win);
        if (pct.known && (!tightest || pct.remaining < tightest.remaining)) {
          tightest = { card, win, remaining: pct.remaining, used: pct.used };
        }
        if (win.resetsAt) {
          const ms = Date.parse(win.resetsAt);
          if (Number.isFinite(ms) && ms > nowMs && (!soonestReset || ms < soonestReset.resetMs)) {
            soonestReset = { card, win, resetMs: ms };
          }
        }
      }
    }

    const credits = collectCredits(allItems);
    const headlineCredit = pickHeadlineCredit(credits, nowMs);

    return { liveCount, localCount, unavailableCount, tightest, soonestReset, credits, headlineCredit };
  }, [allItems, nowMs]);

  if (!limits) {
    return error ? (
      <section className="panel limits-empty">
        <AlertTriangle size={22} aria-hidden="true" />
        <h3>Couldn't load quotas</h3>
        <p>{error}</p>
        {onRefresh && (
          <button type="button" className="btn" disabled={refreshing} onClick={onRefresh}>
            <RefreshCw size={14} className={refreshing ? "spin" : ""} aria-hidden="true" />
            <span>{refreshing ? "Trying…" : "Try again"}</span>
          </button>
        )}
      </section>
    ) : (
      <LimitsSkeleton />
    );
  }

  if (limits.items.length === 0) {
    return (
      <section className="panel limits-empty">
        <Gauge size={22} aria-hidden="true" />
        <h3>No quota sources detected</h3>
        <p>
          Token Larper looks on this machine for Claude Code, Codex, Antigravity, Copilot and OpenCode Go. None of them
          returned a quota.
        </p>
        <p className="muted">
          Sign in to one of them and use it once, then refresh. Credentials are only read locally, from each tool's own
          files.
        </p>
        {onRefresh && (
          <button type="button" className="btn" disabled={refreshing} onClick={onRefresh}>
            <RefreshCw size={14} className={refreshing ? "spin" : ""} aria-hidden="true" />
            <span>{refreshing ? "Refreshing…" : "Check again"}</span>
          </button>
        )}
      </section>
    );
  }

  const generatedMs = Date.parse(limits.generatedAt);
  const payloadAgeMs = Number.isFinite(generatedMs) ? Math.max(0, nowMs - generatedMs) : null;
  const payloadOld = payloadAgeMs !== null && payloadAgeMs > PAYLOAD_OLD_MS;
  const checkedClock = Number.isFinite(generatedMs)
    ? new Date(generatedMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const hasPaceMarker = allItems.some((card) => card.windows.some((w) => computeWindowTimeRemainingPercent(w, nowMs) !== null));
  const filterOptions = (Object.keys(FILTER_LABELS) as LimitsFilter[]).map((id) => ({
    id,
    label: id === "attention" && attentionCount > 0 ? `${FILTER_LABELS[id]} (${attentionCount})` : FILTER_LABELS[id],
  }));

  const tightest = summary.tightest;
  const tightestStatus = tightest ? windowStatusText(tightest.win) : null;
  const headline = summary.headlineCredit;

  return (
    <>
      {error && (
        <div className="inline-error" role="status">
          Couldn't refresh quotas ({error}). Showing the last result.
        </div>
      )}

      <section className="kpi-grid limits-kpis" aria-label="Subscription quota summary">
        <article className="kpi">
          <h3 className="kpi-label">Connected plans</h3>
          <div className="kpi-value">{allItems.length}</div>
          <p className="kpi-sub">
            {summary.liveCount} live · {summary.localCount} local
            {summary.unavailableCount > 0 ? ` · ${summary.unavailableCount} unavailable` : ""}
          </p>
        </article>

        <article className="kpi">
          <h3 className="kpi-label">Tightest window</h3>
          <div
            className={`kpi-value ${tightest ? `limits-status-text is-${windowTone(tightest.win)}` : ""}`}
          >
            {tightest
              ? displayMode === "remaining"
                ? `${formatPercent(tightest.remaining)}% left`
                : `${formatPercent(tightest.used)}% used`
              : "—"}
          </div>
          <p className="kpi-sub">
            {tightest ? `${tightest.card.name} · ${tightest.win.label}` : "No quota windows reported"}
          </p>
          {tightestStatus && tightest && (
            <StatusTag text={tightestStatus} status={windowTone(tightest.win) === "critical" ? "critical" : "warning"} />
          )}
        </article>

        <article className="kpi">
          <h3 className="kpi-label">Next window reset</h3>
          <div className="kpi-value">
            {summary.soonestReset ? formatResetCountdown(summary.soonestReset.win.resetsAt, nowMs) ?? "—" : "—"}
          </div>
          <p className="kpi-sub">
            {summary.soonestReset
              ? `${summary.soonestReset.card.name} (${summary.soonestReset.win.label}) · ${formatResetClock(
                  summary.soonestReset.win.resetsAt,
                  nowMs,
                )}`
              : "No active cooldowns"}
          </p>
        </article>

        <article className="kpi">
          <h3 className="kpi-label">Extra credits</h3>
          <div className="kpi-value is-compact">{headline ? headline.credit.remainingText : "—"}</div>
          <p className="kpi-sub">
            {headline
              ? `${headline.card.name} · ${headline.credit.label}${
                  summary.credits.length > 1 ? ` · +${summary.credits.length - 1} more` : ""
                }`
              : "No promotional or bonus credit buckets"}
          </p>
        </article>
      </section>

      <section className="panel limits-toolbar-panel">
        <div className="limits-toolbar">
          <div className="limits-toolbar-left">
            <Segmented label="Filter subscriptions" value={filter} options={filterOptions} onChange={setFilter} />
            <Segmented label="Quota display mode" value={displayMode} options={DISPLAY_OPTIONS} onChange={setDisplayMode} />
          </div>
          <div className="limits-toolbar-right">
            <span className={`limits-updated-note${payloadOld ? " is-old" : ""}`}>
              {payloadOld && <AlertTriangle size={13} aria-hidden="true" />}
              <time dateTime={Number.isFinite(generatedMs) ? limits.generatedAt : undefined}>
                {checkedClock ? `Checked ${checkedClock}` : "Check time unknown"}
              </time>
              {payloadOld && payloadAgeMs !== null && (
                <span>{` · ${formatAge(limits.generatedAt, nowMs)}, may be out of date`}</span>
              )}
            </span>
            {onRefresh && (
              <button type="button" className="btn" disabled={refreshing} onClick={onRefresh}>
                <RefreshCw size={14} className={refreshing ? "spin" : ""} aria-hidden="true" />
                <span>{refreshing ? "Refreshing…" : "Refresh quotas"}</span>
              </button>
            )}
          </div>
        </div>
        {hasPaceMarker && (
          <p className="limits-legend">
            <span className="limit-pace-key" aria-hidden="true" />
            The tick on a bar marks where an even pace through the window would be right now.
          </p>
        )}
      </section>

      {filteredItems.length === 0 ? (
        <section className="panel limits-empty">
          <Info size={20} aria-hidden="true" />
          <h3>{filter === "attention" ? "Nothing needs attention" : "No plans match this filter"}</h3>
          <p>
            {filter === "attention"
              ? "No plan is running low or unavailable right now."
              : `None of your ${allItems.length} connected ${allItems.length === 1 ? "plan uses" : "plans use"} ${
                  filter === "live" ? "a live provider API" : "the local ledger"
                }.`}
          </p>
          <button type="button" className="btn" onClick={() => setFilter("all")}>
            Show all plans
          </button>
        </section>
      ) : (
        <div className="limits-grid">
          {filteredItems.map((card) => (
            <LimitCard key={card.id} card={card} displayMode={displayMode} nowMs={nowMs} />
          ))}
        </div>
      )}
    </>
  );
}

function LimitsSkeleton() {
  return (
    <div className="limits-skeleton" role="status">
      <span className="sr-only">Checking subscription quotas and rate-limit windows…</span>
      <div className="kpi-grid limits-kpis" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi">
            <span className="skel skel-sm" />
            <span className="skel skel-lg" />
            <span className="skel skel-md" />
          </div>
        ))}
      </div>
      <div className="limits-grid" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="panel limit-card">
            <span className="skel skel-title" />
            <span className="skel skel-block" />
            <span className="skel skel-block" />
          </div>
        ))}
      </div>
    </div>
  );
}

function errorHint(card: HarnessLimitCard): string {
  return card.source === "live"
    ? `Check that ${card.name} is signed in on this machine, then refresh.`
    : `Check that ${card.name} has been used on this machine so there are local logs to read, then refresh.`;
}

function LimitCard({
  card,
  displayMode,
  nowMs,
}: {
  card: HarnessLimitCard;
  displayMode: QuotaDisplayMode;
  nowMs: number;
}) {
  const { seriesOf } = useDashboard();
  const brandColor = seriesOf(card.harness).color;
  const windows = useMemo(() => sortWindows(card.windows), [card.windows]);
  const unavailable = isUnavailable(card);
  const hasCritical = windows.some((w) => w.status === "critical");
  const hasWarning = !hasCritical && windows.some((w) => w.status === "warning");
  const tone = hasCritical ? "is-critical" : unavailable ? "is-error" : hasWarning ? "is-warning" : "";
  const staleAge = formatAge(card.staleSince, nowMs);
  const credits = card.credits ?? [];
  const breakdownItems = card.breakdown?.items ?? [];
  const failedWithData = !!card.error && !unavailable;
  const hasFoot = credits.length > 0 || breakdownItems.length > 0 || !!card.note || failedWithData;

  return (
    <article
      className={["panel limit-card", tone, card.stale && "is-stale"].filter(Boolean).join(" ")}
      aria-label={`${card.name} usage limits`}
    >
      <header className="limit-card-head">
        <div className="limit-card-identity">
          <span className="limit-card-mark" style={{ background: `color-mix(in srgb, ${brandColor} 14%, transparent)` }}>
            <ToolMark harness={card.harness} name={card.name} color={brandColor} size={20} decorative />
          </span>
          <div className="limit-card-names">
            <div className="limit-card-title-row">
              <h3>{card.name}</h3>
              {card.planName && <span className="limit-plan-badge">{card.planName}</span>}
            </div>
            <span className="limit-card-vendor">
              {card.vendor} · {card.sourceLabel ?? (card.source === "live" ? "Live API" : "Local ledger")}
            </span>
          </div>
        </div>
        {card.stale ? (
          <span className="limit-source-pill is-stale">
            <Clock size={12} aria-hidden="true" />
            {staleAge ? `Stale · last updated ${staleAge}` : "Stale · last update time unknown"}
          </span>
        ) : unavailable ? (
          <span className="limit-source-pill is-error">
            <AlertTriangle size={12} aria-hidden="true" />
            Unavailable
          </span>
        ) : (
          <span className={`limit-source-pill is-${card.source}`}>
            <i aria-hidden="true" />
            {card.source === "live" ? "Live" : "Local"}
            <span className="sr-only">
              {card.source === "live"
                ? ": fetched directly from the provider's live quota endpoint"
                : ": calculated from your local session database and rolling window limits"}
            </span>
          </span>
        )}
      </header>

      {unavailable ? (
        <div className="limit-error">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <strong>Couldn't read this quota</strong>
            <p className="limit-error-msg">{card.error}</p>
            <p className="limit-error-hint">{errorHint(card)}</p>
          </div>
        </div>
      ) : windows.length === 0 ? (
        <p className="limit-none muted">No quota windows reported yet.</p>
      ) : (
        <ul className="limit-windows">
          {windows.map((win, index) => (
            <WindowRow key={`${win.id}-${index}`} card={card} win={win} brandColor={brandColor} displayMode={displayMode} nowMs={nowMs} />
          ))}
        </ul>
      )}

      {hasFoot && (
        <footer className="limit-card-foot">
          {credits.length > 0 && (
            <div className="limit-credits-row">
              {credits.map((c, i) => {
                const expCountdown = formatResetCountdown(c.resetsAt, nowMs);
                return (
                  <div key={i} className="limit-credit-pill">
                    <Coins size={13} aria-hidden="true" />
                    <span>{c.label}:</span>
                    <strong>{c.remainingText}</strong>
                    {c.limitText && <span className="muted">of {c.limitText}</span>}
                    {expCountdown && (
                      <span className="muted">· {expCountdown === RESETTING_NOW ? "expiring now" : `expires in ${expCountdown}`}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {breakdownItems.length > 0 && (
            <div className="limit-breakdown">
              <span className="limit-breakdown-label">{card.breakdown!.label}</span>
              <div className="limit-breakdown-pills">
                {breakdownItems.map((item, i) => (
                  <span key={`${item.name}-${i}`} className="limit-breakdown-item">
                    <code>{item.name}</code>
                    <strong>{formatPercent(item.percent)}%</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {failedWithData && (
            <p className="limit-note is-error">
              <AlertTriangle size={13} aria-hidden="true" />
              <span>Last refresh failed: {card.error}</span>
            </p>
          )}

          {card.note && (
            <p className="limit-note">
              <Info size={13} aria-hidden="true" />
              <span>{card.note}</span>
            </p>
          )}
        </footer>
      )}
    </article>
  );
}

function WindowRow({
  card,
  win,
  brandColor,
  displayMode,
  nowMs,
}: {
  card: HarnessLimitCard;
  win: QuotaWindow;
  brandColor: string;
  displayMode: QuotaDisplayMode;
  nowMs: number;
}) {
  const { remaining, used, known } = windowPercents(win);
  const shown = displayMode === "remaining" ? remaining : used;
  const tone = windowTone(win);
  const statusText = windowStatusText(win);
  const countdown = formatResetCountdown(win.resetsAt, nowMs);
  const clock = countdown && countdown !== RESETTING_NOW ? formatResetClock(win.resetsAt, nowMs) : null;
  const paceRemaining = computeWindowTimeRemainingPercent(win, nowMs);
  const pacePos = paceRemaining !== null ? (displayMode === "remaining" ? paceRemaining : 100 - paceRemaining) : null;

  const pctText = known ? `${formatPercent(shown)}% ${displayMode === "remaining" ? "left" : "used"}` : "No data";
  const counter =
    displayMode === "remaining"
      ? win.remainingValueText
      : win.usedValueText && win.limitValueText
      ? `${win.usedValueText} of ${win.limitValueText} used`
      : undefined;
  const valueText = [
    pctText,
    countdown ? describeReset(countdown).toLowerCase() : null,
    paceRemaining !== null ? `${Math.round(paceRemaining)}% of the window time left` : null,
    statusText ? statusText.toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li className={`limit-window is-${tone}`}>
      <div className="limit-window-top">
        <div className="limit-window-labels">
          <strong>{win.label}</strong>
          {win.sublabel && <span className="limit-window-sub">{win.sublabel}</span>}
        </div>
        <div className="limit-window-numbers">
          <span className={`limit-window-pct is-${tone}`}>{pctText}</span>
          {statusText && <StatusTag text={statusText} status={tone === "critical" ? "critical" : "warning"} />}
        </div>
      </div>

      <div
        className="limit-bar-track"
        role="progressbar"
        aria-valuenow={known ? Math.round(shown) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={valueText}
        aria-label={`${card.name}, ${win.label}`}
      >
        <span
          className="limit-bar-fill"
          style={{ width: barWidth(known ? shown : 0), background: windowBarColor(brandColor, win.status) }}
        />
        {pacePos !== null && pacePos > 2 && pacePos < 98 && (
          <span className="limit-bar-pace" style={{ left: `${pacePos}%` }} aria-hidden="true" />
        )}
      </div>

      <div className="limit-window-foot">
        {countdown ? (
          <span className="limit-window-reset">
            <Clock size={13} aria-hidden="true" />
            <span>
              {countdown === RESETTING_NOW ? (
                <strong>{RESETTING_NOW}</strong>
              ) : (
                <>
                  Resets in <strong>{countdown}</strong>
                </>
              )}
              {clock && <time dateTime={win.resetsAt ?? undefined}>{` · ${clock}`}</time>}
            </span>
          </span>
        ) : (
          <span className="limit-window-reset is-unknown">Reset time not reported</span>
        )}
        {counter && <span className="limit-window-counter">{counter}</span>}
      </div>
    </li>
  );
}
