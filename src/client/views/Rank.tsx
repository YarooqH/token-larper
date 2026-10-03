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
  Sparkles,
  Trophy,
  Waves,
  X,
  type Icon,
} from "../components/Icons.tsx";
import { useDashboard } from "../context.tsx";
import { achievements, lastDefeated, lifetimeStats, nextRival, rankFor, TIERS } from "../lib/rank.ts";
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
    { label: "Best streak", value: `${stats.longestStreak?.days ?? 0} days` },
    { label: "Tools", value: String(stats.toolCount) },
    { label: "Spent", value: formatCurrency(stats.verifiedCost, 0) },
  ];

  return (
    <article className="sheet" aria-labelledby="sheet-title">
      <header className="sheet-head">
        <div className="sheet-level" aria-label={`Level ${rank.tier.level} of ${TIERS.length}`}>
          <span aria-hidden="true">Lv</span>
          <strong aria-hidden="true">{rank.tier.level}</strong>
        </div>
        <div className="sheet-identity">
          <h2 id="sheet-title">{rank.tier.title}</h2>
          <span
            className="xp-bar"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(rank.progress)}
            aria-label={rank.next ? `Progress to ${rank.next.title}` : "Maximum level"}
          >
            <span style={{ width: `${rank.progress}%` }} />
          </span>
          <span className="xp-label">
            {rank.next ? `${formatCompactNumber(rank.toNext)} to ${rank.next.title}` : "Maximum level"}
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
