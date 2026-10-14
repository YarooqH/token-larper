import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./paths.ts";
import type { PrivacyStatus } from "./types.ts";

// The settings the server itself has to honor, because they decide what leaves this
// computer. Everything else the dashboard remembers stays in the browser.

export interface SettingsOptions {
  file?: string;
  /** The value of TOKEN_LARPER_OFFLINE; "1" turns offline mode on and the switch can't undo it. */
  envOffline?: () => string | undefined;
}

export function createSettings(options: SettingsOptions = {}) {
  const file = options.file ?? dataPath("settings.json");
  const envOffline = options.envOffline ?? (() => process.env.TOKEN_LARPER_OFFLINE);
  let stored: { offline: boolean } | null = null;

  function load(): { offline: boolean } {
    if (stored) return stored;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { offline?: unknown } | null;
      stored = { offline: raw?.offline === true };
    } catch {
      stored = { offline: false };
    }
    return stored;
  }

  const locked = () => envOffline() === "1";
  const isOffline = () => locked() || load().offline;
  const status = (): PrivacyStatus => ({ offline: isOffline(), locked: locked() });

  function setOffline(offline: boolean): PrivacyStatus {
    load().offline = offline;
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ offline }), "utf8");
    } catch {
      // The choice still applies until the server restarts.
    }
    return status();
  }

  return { isOffline, status, setOffline };
}

export const settings = createSettings();
