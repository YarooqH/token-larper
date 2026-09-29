import { logoPaths } from "../logoMark.ts";
import { formatCompactNumber, formatCurrency } from "../utils.ts";
import { formatSpan } from "./range.ts";
import { lastDefeated, nextRival, rankFor, TIERS, type LifetimeStats } from "./rank.ts";

// The share card is one SVG string, so the preview and the exported PNG are the same image.
// It never includes project names or paths; cost is opt-in. Colors come from the live
// theme, so the card matches whichever palette and light/dark mode is active.

export const CARD_W = 1200;
export const CARD_H = 630;

export interface CardOptions {
  showCost: boolean;
  earnedBadges: number;
  totalBadges: number;
  topToolName: string | null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const FONT = "'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif";

export interface CardColors {
  bg: string;
  line: string;
  track: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  accentInk: string;
  gold: string;
}

/** Resolve the theme tokens to concrete colors; an SVG rendered as an image can't see CSS variables. */
export function themeCardColors(): CardColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--surface", "#1b221e"),
    line: v("--border", "#2e3932"),
    track: v("--surface-3", "#2b362f"),
    text: v("--text", "#e8eee7"),
    text2: v("--text-2", "#b5c1b7"),
    text3: v("--text-3", "#98a59b"),
    accent: v("--accent", "#2f5a43"),
    accentInk: v("--accent-ink", "#ffffff"),
    gold: v("--gold", "#e1b75c"),
  };
}

export function shareCardSvg(stats: LifetimeStats, opts: CardOptions, c: CardColors): string {
  const rank = rankFor(stats.tokens);
  const passed = lastDefeated(stats.tokens);
  const next = nextRival(stats.tokens);
  const barW = 520;
  const fill = Math.max(8, (rank.progress / 100) * barW);

  const cells: [string, string][] = [
    ["Lifetime tokens", formatCompactNumber(stats.tokens)],
    opts.showCost ? ["Verified cost", formatCurrency(stats.verifiedCost)] : ["Active days", String(stats.activeDays)],
    ["Longest streak", `${stats.longestStreak?.days ?? 0} days`],
    ["Badges", `${opts.earnedBadges} / ${opts.totalBadges}`],
  ];

  const statBlocks = cells
    .map(([label, value], i) => {
      const x = 80 + i * 262;
      return `<text x="${x}" y="420" font-size="20" fill="${c.text3}">${esc(label)}</text>
<text x="${x}" y="464" font-size="40" font-weight="700" fill="${c.text}">${esc(value)}</text>`;
    })
    .join("\n");

  const favorites = [
    opts.topToolName ? `Main tool: ${opts.topToolName}` : null,
    stats.topModel ? `Top model: ${clip(stats.topModel, 34)}` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");

  const rivalLine = next
    ? `Next rival: ${clip(next.name, 52)} in ${formatCompactNumber(next.tokens - stats.tokens)}`
    : passed
      ? `Passed every rival, last one: ${clip(passed.name, 48)}`
      : "";

  const since = stats.days[0] ? `Since ${formatSpan(stats.days[0].period, stats.days[stats.days.length - 1]!.period)}` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="${FONT}">
<rect width="${CARD_W}" height="${CARD_H}" fill="${c.bg}"/>
<g transform="translate(80 64) scale(0.875)">${logoPaths(c.text)}</g>
<text x="148" y="104" font-size="28" font-weight="700" fill="${c.text}">Token Larper</text>
<text x="${CARD_W - 80}" y="104" font-size="20" fill="${c.text3}" text-anchor="end">${esc(since)}</text>
<text x="80" y="196" font-size="22" font-weight="700" letter-spacing="3" fill="${c.gold}">LARP RANK · LEVEL ${rank.tier.level} OF ${TIERS.length}</text>
<text x="80" y="268" font-size="68" font-weight="700" fill="${c.text}">${esc(rank.tier.title)}</text>
<rect x="80" y="304" width="${barW}" height="14" rx="7" fill="${c.track}"/>
<rect x="80" y="304" width="${fill}" height="14" rx="7" fill="${c.gold}"/>
<text x="${80 + barW + 24}" y="318" font-size="22" fill="${c.text2}">${esc(
    rank.next ? `${formatCompactNumber(rank.toNext)} to ${rank.next.title}` : "Top tier reached"
  )}</text>
<text x="80" y="370" font-size="24" font-style="italic" fill="${c.text2}">${esc(`“${rank.tier.quip}”`)}</text>
${statBlocks}
<line x1="80" y1="506" x2="${CARD_W - 80}" y2="506" stroke="${c.line}" stroke-width="2"/>
<text x="80" y="550" font-size="21" fill="${c.text2}">${esc(favorites)}</text>
<text x="80" y="588" font-size="21" fill="${c.text3}">${esc(rivalLine)}</text>
</svg>`;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Rasterize at 2x for a crisp PNG. */
export async function cardPng(svg: string): Promise<Blob> {
  const img = new Image();
  img.decoding = "async";
  img.src = svgDataUrl(svg);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * 2;
  canvas.height = CARD_H * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image"))), "image/png")
  );
}
