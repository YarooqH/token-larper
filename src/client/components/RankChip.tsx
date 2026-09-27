import React from "react";
import { Crown } from "lucide-react";
import { rankFor } from "../lib/rank.ts";
import { formatCompactNumber } from "../utils.ts";

/** Compact lifetime rank in the header; opens the Rank tab. */
export function RankChip({ tokens, onOpen, active }: { tokens: number; onOpen: () => void; active: boolean }) {
  const rank = rankFor(tokens);
  const label = rank.next
    ? `${rank.tier.title}, level ${rank.tier.level}. ${formatCompactNumber(rank.toNext)} tokens to ${rank.next.title}. Open rank.`
    : `${rank.tier.title}, top level. Open rank.`;
  return (
    <button type="button" className={`rank-chip ${active ? "is-active" : ""}`} onClick={onOpen} aria-label={label} title={label}>
      <Crown size={14} aria-hidden="true" />
      <span className="rank-chip-level">Lv {rank.tier.level}</span>
      <span className="rank-chip-title">{rank.tier.title}</span>
      <span className="rank-chip-bar" aria-hidden="true">
        <span style={{ width: `${rank.progress}%` }} />
      </span>
    </button>
  );
}
