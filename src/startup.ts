import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StartupConfig } from "./types.ts";
import { APP_VERSION, DATA_DIR, dataPath, RUNNING_FROM_SOURCE } from "./paths.ts";
import { NO_ENTRY, samePath, type EntryState, type StartupBackend } from "./startup/backend.ts";
import { linuxBackend } from "./startup/linux.ts";
import { macosBackend } from "./startup/macos.ts";
import { shouldRepoint } from "./startup/repoint.ts";
import { windowsBackend } from "./startup/windows.ts";

const SETTINGS_FILE = dataPath("settings.json");

interface SavedSettings {
  openBrowserOnBoot: boolean;
  port: number;
}

function validPort(value: unknown, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function loadSavedSettings(defaultPort = 4269): SavedSettings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
      return {
        openBrowserOnBoot: raw.openBrowserOnBoot === true,
        port: validPort(raw.port, defaultPort),
      };
    }
  } catch {
    // A missing or damaged settings file falls back to the default port.
  }
  return { openBrowserOnBoot: false, port: defaultPort };
}

function saveSettings(settings: SavedSettings): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

function backend(): StartupBackend {
  if (process.platform === "win32") return windowsBackend;
  if (process.platform === "darwin") return macosBackend;
  return linuxBackend;
}

async function readState(b: StartupBackend): Promise<EntryState> {
  try {
    return await b.read();
  } catch {
    // Status stays readable if reg.exe or launchctl is unavailable.
    return NO_ENTRY;
  }
}

export async function getStartupStatus(defaultPort = 4269): Promise<StartupConfig> {
  const saved = loadSavedSettings(defaultPort);
  const b = backend();
  const state = await readState(b);
  const ours = state.target !== null && samePath(state.target, b.launcherPath, b.platform);
  return {
    enabled: ours && !state.disabledBySystem,
    openBrowserOnBoot: saved.openBrowserOnBoot,
    port: defaultPort,
    platform: b.platform,
    entry: state.entry,
    entryPath: b.entryPath,
    disabledBySystem: ours && state.disabledBySystem,
    launcherPath: b.launcherPath,
  };
}

export async function setStartupStatus(options: {
  enabled: boolean;
  openBrowserOnBoot?: boolean;
  port?: number;
}): Promise<StartupConfig> {
  const current = loadSavedSettings();
  const next: SavedSettings = {
    openBrowserOnBoot: options.openBrowserOnBoot ?? current.openBrowserOnBoot,
    port: validPort(options.port ?? current.port, current.port),
  };

  const b = backend();
  if (options.enabled) {
    b.assertCanEnable();
    await b.write();
  } else if ((await readState(b)).entry !== null) {
    await b.remove();
  }

  saveSettings(next);
  return getStartupStatus(next.port);
}

function versionAt(launcher: string): string | null {
  try {
    // Both launchers sit two folders below the package root: scripts/launch-silent.vbs, bin/cli.js.
    const pkg = join(launcher, "..", "..", "package.json");
    return String(JSON.parse(readFileSync(pkg, "utf8")).version || "0.0.0");
  } catch {
    return null;
  }
}

/** When startup is on and the entry starts an older or deleted copy, point it at this one. */
export async function repointStartupIfStale(): Promise<void> {
  // A test or dev copy (throwaway data folder, git checkout) must not take over the login entry;
  // turning startup on from Settings still works there.
  if (process.env.TOKEN_LARPER_DATA_DIR || RUNNING_FROM_SOURCE) return;
  try {
    const b = backend();
    const state = await b.read();
    const target = state.target;
    if (!target) return;
    const repoint = shouldRepoint({
      state,
      isThisCopy: samePath(target, b.launcherPath, b.platform),
      targetExists: existsSync(target),
      runnerExists: state.runner === null || existsSync(state.runner),
      targetVersion: versionAt(target),
      appVersion: APP_VERSION,
    });
    if (!repoint) return;
    b.assertCanEnable();
    await b.write();
  } catch {
    // The old entry keeps working; Settings can turn startup off and on again.
  }
}
