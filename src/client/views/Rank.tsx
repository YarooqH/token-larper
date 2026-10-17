import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Boxes,
  CalendarDays,
  Coins,
  Copy,
  Database,
  Download,
  Fish,
  Flame,
  FolderGit2,
  Heart,
  Languages,
  Moon,
  Share2,
  Shield,
  Snowflake,
  Sparkles,
  Trophy,
  Waves,
  X,
  type Icon,
} from "../components/Icons.tsx";
import { useDashboard } from "../context.tsx";
import { achievements, DAILY_GOAL, dayStreak, FREEZE_CAP, FREEZE_EVERY, lastDefeated, lifetimeStats, nextRival, rankFor, TIERS } from "../lib/rank.ts";
import { addDays, parseDay, todayKey } from "../lib/range.ts";
import { cardPng, shareCardSvg, svgDataUrl, themeCardColors } from "../lib/shareCard.ts";
import { formatCompactNumber, formatCurrency } from "../utils.ts";

const TROPHY_ICONS: Record<string, Icon> = {
  billion: Trophy,
  "ten-billion": Sparkles,
  "streak-7": Flame,
  "streak-30": Shield,
  "night-owl": Moon,
  polyglot: Languages,
  whale: Fish,
  leviathan: Waves,
  "big-spender": Banknote,
  "free-lunch": Coins,
  weekend: CalendarDays,
  "cache-goblin": Database,
  hopper: FolderGit2,
  collector: Boxes,
  loyalist: Heart,
};

// Earned seals take a color from the chart series, so the row isn't one flat gold.
const SEAL_COLORS: Record<string, string> = {
  billion: "var(--series-4)",
  "ten-billion": "var(--series-5)",
  "streak-7": "var(--flame)",
  "streak-30": "var(--flame)",
  "night-owl": "var(--series-7)",
  polyglot: "var(--series-1)",
  whale: "var(--series-1)",
  leviathan: "var(--freeze)",
  "big-spender": "var(--series-6)",
  "free-lunch": "var(--series-3)",
  weekend: "var(--series-2)",
  "cache-goblin": "var(--series-3)",
  hopper: "var(--series-7)",
  collector: "var(--series-2)",
  loyalist: "var(--series-5)",
};

type DayState = "goal" | "used" | "frozen" | "none";

const DAY_STATE_LABELS: Record<DayState, string> = {
  goal: "hit the daily goal",
  used: "used a coding tool",
  frozen: "streak freeze used",
  none: "no usage",
};

function ShareDialog({ svg, showCost, setShowCost, onClose }: {
  svg: string;
  showCost: boolean;
  setShowCost: (v: boolean) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  async function download() {
    try {
      const url = URL.createObjectURL(await cardPng(svg));
      const a = document.createElement("a");
      a.href = url;
      a.download = `token-larper-rank-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("Saved to your downloads.");
    } catch {
      setStatus("Couldn't create the image.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await cardPng(svg) })]);
      setStatus("Copied. Paste it anywhere.");
    } catch {
      setStatus("Your browser blocked copying. Download it instead.");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h3 id="share-title">Share your rank</h3>
            <p>A 1200 × 630 image. It never includes project names or file paths.</p>
          </div>
          <button ref={closeRef} className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="share-body">
          <img className="share-preview" src={svgDataUrl(svg)} alt="Preview of your share card" />
        </div>
        <footer className="share-actions">
          <label className="check">
            <input type="checkbox" checked={showCost} onChange={(e) => setShowCost(e.target.checked)} />
            Include verified cost
          </label>
          <span className="share-status" role="status">{status}</span>
          <button className="btn" onClick={() => void copy()}>
            <Copy size={14} aria-hidden="true" /> Copy
          </button>
          <button className="btn btn-primary" onClick={() => void download()}>
            <Download size={14} aria-hidden="true" /> Download PNG
          </button>
        </footer>
      </div>
    </div>
  );
}

export function Rank() {
  const { data, nameOf } = useDashboard();
  const stats = useMemo(() => lifetimeStats(data), [data]);
  const rank = rankFor(stats.tokens);
  const badges = useMemo(() => achievements(data, stats), [data, stats]);
  const earned = badges.filter((b) => b.earned).length;
  // Earned first, then locked by how close they are, so the row reads left to right.
  const ordered = useMemo(
    () =>
      [...badges].sort((a, b) =>
        a.earned !== b.earned ? (a.earned ? -1 : 1) : b.progress.current / b.progress.target - a.progress.current / a.progress.target
      ),
    [badges]
  );
  const closest = ordered.find((b) => !b.earned) ?? null;
  const rival = nextRival(stats.tokens);
  const floor = lastDefeated(stats.tokens)?.tokens ?? 0;
  const rivalPct = rival ? Math.min(100, ((stats.tokens - floor) / (rival.tokens - floor)) * 100) : 100;

  const streak = dayStreak(data);
  const best = stats.longestStreak?.days ?? 0;
  const lit = streak.days > 0 && streak.goalMet;
  const today = todayKey();
  const tokensByDay = useMemo(() => new Map(stats.days.map((d) => [d.period, d.totalTokens])), [stats.days]);
  const frozenDays = new Set(streak.frozen);
  const week = Array.from({ length: 7 }, (_, i) => {
    const key = addDays(today, i - 6);
    const date = parseDay(key);
    const tokens = tokensByDay.get(key);
    const state: DayState =
      tokens !== undefined ? (tokens >= DAILY_GOAL ? "goal" : "used") : frozenDays.has(key) ? "frozen" : "none";
    return {
      key,
      state,
      isToday: key === today,
      letter: date.toLocaleDateString("en-US", { weekday: "narrow" }),
      name: date.toLocaleDateString("en-US", { weekday: "long" }),
    };
  });
  const status =
    streak.days === 0
      ? "Use a coding tool today to start a streak."
      : streak.goalMet
        ? "You're covered for today."
        : streak.doneToday
          ? `Covered for today. ${formatCompactNumber(DAILY_GOAL - streak.todayTokens)} more tokens lights the flame.`
          : "Use a coding tool today to keep it going.";
  const freezesFull = streak.freezes >= FREEZE_CAP;
  const freezePct = freezesFull ? 100 : ((FREEZE_EVERY - streak.nextFreezeIn) / FREEZE_EVERY) * 100;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [showCost, setShowCost] = useState(false);
  const closeShare = React.useCallback(() => setSharing(false), []);
  const selected = badges.find((b) => b.id === selectedId) ?? closest;

  // Read the theme when the dialog opens, so the card matches the active palette and mode.
  const svg = useMemo(
    () =>
      sharing
        ? shareCardSvg(
            stats,
            {
              showCost,
              earnedBadges: earned,
              totalBadges: badges.length,
              topToolName: stats.topTool ? nameOf(stats.topTool.id) : null,
            },
            themeCardColors()
          )
        : "",
    [sharing, stats, showCost, earned, badges.length, nameOf]
  );

  const numbers = [
    { label: "Tokens", value: formatCompactNumber(stats.tokens) },
    { label: "Active days", value: String(stats.activeDays) },
    { label: "Tools", value: String(stats.toolCount) },
    { label: "Spent", value: formatCurrency(stats.verifiedCost, 0) },
  ];

  return (
    <article className="sheet" aria-labelledby="sheet-title">
      <header className="sheet-head">
        <Flame className={`sheet-flame ${lit ? "is-lit" : ""}`} size={44} fill={lit ? "currentColor" : "none"} aria-hidden="true" />
        <div className="sheet-identity">
          <h2 id="sheet-title">{streak.days > 0 ? `${streak.days} day streak` : "No streak yet"}</h2>
          <ol className="week" aria-label="Last 7 days">
            {week.map((d) => (
              <li
                key={d.key}
                className={`week-day is-${d.state} ${d.isToday ? "is-today" : ""}`}
                aria-label={`${d.name}${d.isToday ? ", today" : ""}: ${DAY_STATE_LABELS[d.state]}`}
              >
                <span className="week-dot" aria-hidden="true" />
                <span className="week-name" aria-hidden="true">{d.letter}</span>
              </li>
            ))}
          </ol>
          <span className="xp-label">
            {status}
            {best > 0 && (best > streak.days ? ` Best: ${best} days.` : " Your longest yet.")}
          </span>
        </div>
        <button className="icon-btn sheet-share" onClick={() => setSharing(true)} aria-label="Share your rank" title="Share">
          <Share2 size={16} />
        </button>
      </header>

      <dl className="sheet-numbers">
        {numbers.map((n) => (
          <div key={n.label}>
            <dt>{n.label}</dt>
            <dd>{n.value}</dd>
          </div>
        ))}
      </dl>

      <section className="sheet-row" aria-label="Rank">
        <span className="sheet-row-label">Rank</span>
        <div className="sheet-rival">
          <strong>
            {rank.tier.title} <span className="rank-level">Level {rank.tier.level} of {TIERS.length}</span>
          </strong>
          <span
            className="rival-bar rank-bar"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(rank.progress)}
            aria-label={rank.next ? `Progress to ${rank.next.title}` : "Top rank"}
          >
            <span style={{ width: `${rank.progress}%` }} />
          </span>
        </div>
        <span className="sheet-row-value">{rank.next ? `${formatCompactNumber(rank.toNext)} to ${rank.next.title}` : "Top rank"}</span>
      </section>

      <section className="sheet-row" aria-label="Streak freezes">
        <span className="sheet-row-label">Freezes</span>
        <div className="sheet-rival">
          <strong className="freeze-count">
            <Snowflake size={14} aria-hidden="true" /> {streak.freezes} of {FREEZE_CAP} ready
          </strong>
          <span
            className="rival-bar freeze-bar"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(freezePct)}
            aria-label="Progress to the next streak freeze"
          >
            <span style={{ width: `${freezePct}%` }} />
          </span>
        </div>
        <span
          className="sheet-row-value"
          title={`Every ${formatCompactNumber(FREEZE_EVERY)} tokens earns a freeze that covers one missed day. You can hold ${FREEZE_CAP}.`}
        >
          {freezesFull ? "Full" : `${formatCompactNumber(streak.nextFreezeIn)} to next freeze`}
        </span>
      </section>

      {rival && (
        <section className="sheet-row" aria-label="Next rival">
          <span className="sheet-row-label">Next rival</span>
          <div className="sheet-rival">
            <strong>{rival.name}</strong>
            <span className="rival-bar" aria-hidden="true"><span style={{ width: `${rivalPct}%` }} /></span>
          </div>
          <span className="sheet-row-value">{formatCompactNumber(rival.tokens - stats.tokens)} to go</span>
        </section>
      )}

      <section className="sheet-row sheet-badges" aria-label="Badges">
        <span className="sheet-row-label">Badges <span>{earned}/{badges.length}</span></span>
        <div>
          <ul className="seals">
            {ordered.map((b) => {
              const Icon = TROPHY_ICONS[b.id] ?? Trophy;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    className={`seal ${b.earned ? "is-earned" : ""}`}
                    style={b.earned && SEAL_COLORS[b.id] ? ({ "--seal": SEAL_COLORS[b.id] } as React.CSSProperties) : undefined}
                    aria-pressed={selected?.id === b.id}
                    aria-label={`${b.name}, ${b.earned ? "earned" : `locked, ${b.progress.label}`}`}
                    title={b.name}
                    onClick={() => setSelectedId(b.id)}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && (
            <p className="seal-detail" aria-live="polite">
              <strong>{selected.name}</strong> {selected.requirement}{" "}
              <span>{selected.earned ? selected.detail : selected.progress.label}</span>
            </p>
          )}
        </div>
      </section>

      {sharing && <ShareDialog svg={svg} showCost={showCost} setShowCost={setShowCost} onClose={closeShare} />}
    </article>
  );
}
