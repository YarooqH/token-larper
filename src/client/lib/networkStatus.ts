import type { PricingStatus } from "../../types.ts";
import { timeAgo } from "./prices.ts";

// One short line per outside request the app can make, for Settings → Privacy.

export function updateCheckLine(opts: { offline: boolean; autoCheck: boolean; checkedAt: string | null | undefined }, now = Date.now()): string {
  if (opts.offline) return "Paused";
  if (opts.checkedAt) return `Checked ${timeAgo(opts.checkedAt, now)}`;
  return opts.autoCheck ? "Not yet" : "Off";
}

export function priceListLine(opts: { offline: boolean; status: PricingStatus | undefined }, now = Date.now()): string {
  const fetchedAt = opts.status?.fetchedAt;
  if (opts.offline) return fetchedAt ? `Paused · saved ${timeAgo(fetchedAt, now)}` : "Paused";
  if (!fetchedAt) return "Not downloaded yet";
  return opts.status?.lastDownloadFailed ? `Updated ${timeAgo(fetchedAt, now)} · retrying` : `Updated ${timeAgo(fetchedAt, now)}`;
}
