import type { PricingStatus } from "../../types.ts";

/**
 * A per-1M price to the cent, or to the digit for fractional-cent prices: OpenRouter
 * lists $0.125 and $0.0375 exactly, and rounding them to cents would misstate the list.
 * Long decimals (a cache price of $0.0416666...) are cut to four significant digits.
 */
export function formatRate(rate: number): string {
  if (rate === 0) return "$0";
  const rounded = Number(rate.toPrecision(4));
  const fraction = rounded.toFixed(6).replace(/0+$/, "").split(".")[1] ?? "";
  return `$${rounded.toFixed(Math.max(2, fraction.length))}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** One sentence on which price list is in use and how fresh it is. */
export function statusLine(status: PricingStatus | undefined, now = Date.now()): string {
  if (!status?.fetchedAt) {
    return status?.offline
      ? "Offline, and no OpenRouter price list has been saved yet, so only Anthropic's rates for Claude are known."
      : "OpenRouter's price list hasn't downloaded yet, so only Anthropic's rates for Claude are known.";
  }
  const list = `OpenRouter's price list (${status.models.toLocaleString("en-US")} models, updated ${timeAgo(status.fetchedAt, now)})`;
  if (status.offline) return `From the saved copy of ${list}. Downloads are off.`;
  if (status.lastDownloadFailed) return `From the saved copy of ${list}. The latest download failed and will be retried.`;
  return `From ${list}.`;
}
