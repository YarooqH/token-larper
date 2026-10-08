import { homedir } from "node:os";
import { join } from "node:path";
import type { PlanUsage } from "../types.ts";

// The Claude desktop app samples the signed-in plan's usage limits every 15 minutes or so
// while it is checking usage, and keeps the samples in plan-usage-history.json. It is the
// only record on this computer that includes chats on claude.ai and in the app, since plan
// limits count all Claude use. The file is the app's own and undocumented: "fh" is the
// 5-hour limit and "sd" the weekly one, in percent, as their resets show.

export function planUsagePath(): string {
  const home = homedir();
  if (process.platform === "win32") return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "plan-usage-history.json");
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Claude", "plan-usage-history.json");
  return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "Claude", "plan-usage-history.json");
}

const percent = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : null);

/** The latest sample, for whichever account the app checked last; null if there is none. */
export function parsePlanUsage(doc: unknown): PlanUsage | null {
  const samples = (doc as { samples?: unknown })?.samples;
  if (!Array.isArray(samples)) return null;
  let latest: { t: number; u: Record<string, unknown> } | null = null;
  for (const s of samples) {
    const t = Number(s?.t);
    if (!Number.isFinite(t) || !s?.u || typeof s.u !== "object") continue;
    if (!latest || t > latest.t) latest = { t, u: s.u };
  }
  if (!latest) return null;
  const fiveHour = percent(latest.u.fh);
  const weekly = percent(latest.u.sd);
  return fiveHour === null && weekly === null ? null : { at: latest.t, fiveHour, weekly };
}

export async function readPlanUsage(path = planUsagePath()): Promise<PlanUsage | null> {
  try {
    return parsePlanUsage(JSON.parse(await Bun.file(path).text()));
  } catch {
    return null;
  }
}
