import React, { useEffect, useMemo, useState } from "react";
import type { HarnessLimitCard, LimitsPayload, QuotaWindow } from "../../types.ts";
import { AlertTriangle, RefreshCw } from "../components/Icons.tsx";
import { ToolMark } from "../components/ToolMark.tsx";
import { useDashboard } from "../context.tsx";
import { formatCompactNumber } from "../utils.ts";

/** A payload older than this means polling is failing or paused, so the header says how old it is. */
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

const RESETTING_NOW = "Resetting now";

/** Formats a future ISO reset time into a human countdown (e.g. "3h 47m", "4d 19h", "18m"). */
export function formatResetCountdown(resetsAt: string | null | undefined, nowMs = Date.now()): string | null {
  if (!resetsAt) return null;
  const targetMs = Date.parse(resetsAt);
  if (!Number.isFinite(targetMs)) return null;
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return RESETTING_NOW;

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

/** "Resets in 3h 12m", or "Resetting now" when the countdown has run out. */
function describeReset(countdown: string): string {
  return countdown === RESETTING_NOW ? RESETTING_NOW : `Resets in ${countdown}`;
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

/** Picks the most urgent or primary window for a harness card (for the summary strip). */
export function pickPrimaryWindow(card: HarnessLimitCard): QuotaWindow | null {
  const windows = sortWindows(card.windows);
  if (windows.length === 0) return null;
  // The tightest window wins when anything is flagged or nearly out; otherwise the shortest window leads.
  // A window with no number counts as 100% left, so it never outranks one with a real percent.
  const left = (w: QuotaWindow) => {
    const p = windowPercents(w);
    return p.known ? p.remaining : 100;
  };
  let tightest: QuotaWindow | null = null;
  for (const win of windows) {
    const urgent = win.status === "warning" || win.status === "critical" || left(win) <= 20;
    if (urgent && (!tightest || left(win) < left(tightest))) tightest = win;
  }
  return tightest ?? windows[0]!;
}

/** The word that backs up the colour of a non-ok window; null when the window is healthy. */
export function windowStatusText(win: Pick<QuotaWindow, "status" | "remainingPercent" | "usedPercent">): string | null {
  if (win.status === "critical") {
    const { remaining, known } = windowPercents(win);
    return known && remaining <= 0 ? "Limit reached" : "Almost out";
  }
  if (win.status === "warning") return "Low";
  return null;
}

/** "127 messages · 867K tokens" for a locally estimated session. */
function describeBlockActivity(block: NonNullable<HarnessLimitCard["block"]>): string {
  const messages = finite(block.messages) ? block.messages : 0;
  const tokens = finite(block.tokens) ? block.tokens : 0;
  return `${messages.toLocaleString()} ${messages === 1 ? "message" : "messages"} · ${formatCompactNumber(tokens)} tokens`;
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

/** The credit bucket worth one line: the one expiring soonest, else the first listed. */
export function pickHeadlineCredit(credits: CardCredit[], nowMs = Date.now()): CardCredit | null {
  let soonest: { credit: CardCredit; ms: number } | null = null;
  for (const credit of credits) {
    const ms = credit.resetsAt ? Date.parse(credit.resetsAt) : NaN;
    if (Number.isFinite(ms) && ms > nowMs && (!soonest || ms < soonest.ms)) soonest = { credit, ms };
  }
  return soonest?.credit ?? credits[0] ?? null;
}

/** A card note earns a line only when it says something the Live / Local tag does not. */
function usefulNote(card: HarnessLimitCard): string | null {
  const note = card.note?.trim();
  if (!note || /^estimated from local/i.test(note)) return null;
  return note;
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

function RefreshButton({ refreshing, onRefresh, label }: { refreshing?: boolean; onRefresh: () => void; label: string }) {
  return (
    <button type="button" className="btn" disabled={refreshing} onClick={onRefresh}>
      <RefreshCw size={14} className={refreshing ? "spin" : ""} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Compact strip shown on Overview / Tools: one tile per plan with its tightest window,
 * and a link to the full Limits view.
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

  return (
    <section className="panel limits-strip" aria-label="Remaining subscription quotas">
      <div className="limits-strip-head">
        <strong>Quota</strong>
        <button type="button" className="limits-strip-link" onClick={onOpenLimits}>
          All limits
        </button>
      </div>
      <div className="limits-strip-grid">
        {cards.map((card) => (
          <MiniCard key={card.id} card={card} nowMs={nowMs} onOpen={onOpenLimits} />
        ))}
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

  if (!primary && card.block) {
    const countdown = formatResetCountdown(card.block.endsAt, nowMs);
    return (
      <button type="button" className="limits-mini-card is-empty" onClick={onOpen}>
        <div className="limits-mini-top">
          {tool}
          <span className="limits-mini-pct">{countdown ? describeReset(countdown) : "5-hour session"}</span>
        </div>
        <p className="limits-mini-line">{describeBlockActivity(card.block)}</p>
      </button>
    );
  }

  if (!primary) {
    const failed = !!card.error;
    return (
      <button type="button" className={`limits-mini-card ${failed ? "is-error" : "is-empty"}`} onClick={onOpen}>
        <div className="limits-mini-top">
          {tool}
          <span className="limits-mini-flag">{failed ? "Unavailable" : "No data"}</span>
        </div>
        {card.error && <p className="limits-mini-line">{card.error}</p>}
      </button>
    );
  }

  const { remaining, known } = windowPercents(primary);
  const statusText = windowStatusText(primary);
  const countdown = formatResetCountdown(primary.resetsAt, nowMs);
  const staleAge = card.stale ? formatAge(card.staleSince, nowMs) : null;
  const line = card.stale
    ? `Stale${staleAge ? ` · ${staleAge}` : ""}`
    : countdown
    ? describeReset(countdown)
    : primary.remainingValueText ?? "";

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
      {line && <p className="limits-mini-line">{line}</p>}
    </button>
  );
}

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
  /** The last fetch failed; shown as a line over stale data, or as the whole state when there is none. */
  error?: string | null;
  /** Fixes the clock for the first render (tests). */
  now?: number;
}) {
  const nowMs = useNow(now);

  // The Limits tab ignores the global tool filter: its picker is hidden here, so a filter set
  // elsewhere would leave a shortened list with no way to clear it.
  const cards = useMemo(() => sortCards(limits?.items ?? []), [limits]);

  if (!limits) {
    return error ? (
      <section className="panel limits-empty">
        <p>Couldn't load quotas ({error}).</p>
        {onRefresh && <RefreshButton refreshing={refreshing} onRefresh={onRefresh} label="Retry" />}
      </section>
    ) : (
      <LimitsSkeleton />
    );
  }

  const generatedMs = Date.parse(limits.generatedAt);
  const known = Number.isFinite(generatedMs);
  const old = known && nowMs - generatedMs > PAYLOAD_OLD_MS;
  const updated = !known
    ? null
    : old
    ? `Updated ${formatAge(limits.generatedAt, nowMs)}`
    : `Updated ${new Date(generatedMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

  return (
    <>
      {error && (
        <div className="inline-error" role="status">
          Couldn't refresh ({error}). Showing the last result.
        </div>
      )}

      <div className="limits-bar">
        {updated && (
          <span className={`limits-updated${old ? " is-old" : ""}`}>
            {old && <AlertTriangle size={13} aria-hidden="true" />}
            <time dateTime={limits.generatedAt}>{updated}</time>
          </span>
        )}
        {onRefresh && <RefreshButton refreshing={refreshing} onRefresh={onRefresh} label="Refresh" />}
      </div>

      {cards.length === 0 ? (
        <section className="panel limits-empty">
          <p>No quota sources found. Sign in to Claude Code, Codex, Copilot or Antigravity.</p>
        </section>
      ) : (
        <div className="limits-grid">
          {cards.map((card) => (
            <LimitCard key={card.id} card={card} nowMs={nowMs} />
          ))}
        </div>
      )}
    </>
  );
}

function LimitsSkeleton() {
  return (
    <div className="limits-skeleton" role="status">
      <span className="sr-only">Loading quotas…</span>
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

function CardStatus({ card, unavailable, nowMs }: { card: HarnessLimitCard; unavailable: boolean; nowMs: number }) {
  if (unavailable) {
    return (
      <span className="limit-status is-error">
        <i aria-hidden="true" />
        Unavailable
      </span>
    );
  }
  if (card.stale) {
    const age = formatAge(card.staleSince, nowMs);
    return (
      <span className="limit-status is-stale" title={age ? `Last updated ${age}` : undefined}>
        <i aria-hidden="true" />
        Stale
      </span>
    );
  }
  return (
    <span className={`limit-status is-${card.source}`}>
      <i aria-hidden="true" />
      {card.source === "live" ? "Live" : "Local"}
    </span>
  );
}

function LimitCard({ card, nowMs }: { card: HarnessLimitCard; nowMs: number }) {
  const { seriesOf } = useDashboard();
  const brandColor = seriesOf(card.harness).color;
  const windows = useMemo(() => sortWindows(card.windows), [card.windows]);
  const unavailable = isUnavailable(card);
  const hasCritical = windows.some((w) => w.status === "critical");
  const hasWarning = !hasCritical && windows.some((w) => w.status === "warning");
  const tone = hasCritical ? "is-critical" : unavailable ? "is-error" : hasWarning ? "is-warning" : "";

  const credit = pickHeadlineCredit(card.credits ?? [], nowMs);
  const breakdownItems = card.breakdown?.items ?? [];
  const note = usefulNote(card);
  const refreshFailed = !!card.error && !unavailable;
  const hasFoot = !!credit || breakdownItems.length > 0 || !!note || refreshFailed;

  return (
    <article
      className={["panel limit-card", tone, card.stale && "is-stale"].filter(Boolean).join(" ")}
      aria-label={`${card.name} usage limits`}
    >
      <header className="limit-card-head">
        <div className="limit-card-title">
          <ToolMark harness={card.harness} name={card.name} color={brandColor} size={18} decorative />
          <h3>{card.name}</h3>
        </div>
        {card.planName && <span className="limit-plan-badge">{card.planName}</span>}
        <CardStatus card={card} unavailable={unavailable} nowMs={nowMs} />
      </header>

      {unavailable ? (
        <p className="limit-error-line">{card.error}</p>
      ) : windows.length === 0 && card.block ? (
        <BlockRow block={card.block} nowMs={nowMs} />
      ) : windows.length === 0 ? (
        <p className="limit-none">No quota data yet.</p>
      ) : (
        <ul className="limit-windows">
          {windows.map((win, index) => (
            <WindowRow key={`${win.id}-${index}`} card={card} win={win} brandColor={brandColor} nowMs={nowMs} />
          ))}
        </ul>
      )}

      {hasFoot && (
        <footer className="limit-card-foot">
          {credit && (
            <p className="limit-line">
              {credit.label} {credit.remainingText}
              {(card.credits?.length ?? 0) > 1 ? ` (+${card.credits!.length - 1} more)` : ""}
            </p>
          )}
          {breakdownItems.length > 0 && (
            <details className="limit-breakdown">
              <summary>Breakdown</summary>
              <p className="limit-breakdown-label">{card.breakdown!.label}</p>
              <ul>
                {breakdownItems.map((item, i) => (
                  <li key={`${item.name}-${i}`}>
                    <span>{item.name}</span>
                    <span>{formatPercent(item.percent)}%</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {refreshFailed && <p className="limit-line is-error">Last refresh failed: {card.error}</p>}
          {note && <p className="limit-line">{note}</p>}
        </footer>
      )}
    </article>
  );
}

function BlockRow({ block, nowMs }: { block: NonNullable<HarnessLimitCard["block"]>; nowMs: number }) {
  const countdown = formatResetCountdown(block.endsAt, nowMs);
  return (
    <div className="limit-window is-ok">
      <div className="limit-window-top">
        <span className="limit-window-label">5-hour session</span>
        <span className="limit-window-num">
          <span className="limit-window-pct is-ok">{countdown ? describeReset(countdown) : "Session ended"}</span>
        </span>
      </div>
      <p className="limit-window-foot">{describeBlockActivity(block)}</p>
    </div>
  );
}

function WindowRow({
  card,
  win,
  brandColor,
  nowMs,
}: {
  card: HarnessLimitCard;
  win: QuotaWindow;
  brandColor: string;
  nowMs: number;
}) {
  const { remaining, known } = windowPercents(win);
  const tone = windowTone(win);
  const statusText = windowStatusText(win);
  const countdown = formatResetCountdown(win.resetsAt, nowMs);
  const reset = countdown ? describeReset(countdown) : null;
  const counter = win.remainingValueText
    ? win.limitValueText
      ? `${win.remainingValueText} of ${win.limitValueText}`
      : win.remainingValueText
    : null;
  const foot = [counter, reset].filter(Boolean).join(" · ");

  const pctText = known ? `${formatPercent(remaining)}% left` : "No data";
  const valueText = [pctText, reset?.toLowerCase(), statusText?.toLowerCase()].filter(Boolean).join(", ");

  return (
    <li className={`limit-window is-${tone}`}>
      <div className="limit-window-top">
        <span className="limit-window-label">{win.label}</span>
        <span className="limit-window-num">
          {statusText && <span className={`limit-flag is-${tone}`}>{statusText}</span>}
          <span className={`limit-window-pct is-${tone}`}>{pctText}</span>
        </span>
      </div>

      <div
        className="limit-bar-track"
        role="progressbar"
        aria-valuenow={known ? Math.round(remaining) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={valueText}
        aria-label={`${card.name}, ${win.label}`}
      >
        <span
          className="limit-bar-fill"
          style={{ width: barWidth(known ? remaining : 0), background: windowBarColor(brandColor, win.status) }}
        />
      </div>

      {foot && <p className="limit-window-foot">{foot}</p>}
    </li>
  );
}
