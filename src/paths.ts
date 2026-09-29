import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Where the app's code lives. With npx or bunx this is a package cache folder that
// changes with every version, so nothing that must survive an update is kept here.
export const APP_ROOT = resolve(import.meta.dir, "..");

export const APP_VERSION: string = (() => {
  try {
    return String(JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")).version || "0.0.0");
  } catch {
    return "0.0.0";
  }
})();

/** A git checkout updates with `git pull`, not through npm. */
export const RUNNING_FROM_SOURCE = existsSync(join(APP_ROOT, ".git"));

function defaultDataDir(): string {
  if (process.env.TOKEN_LARPER_DATA_DIR) return resolve(process.env.TOKEN_LARPER_DATA_DIR);
  const home = homedir();
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "TokenLarper");
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "TokenLarper");
  return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "token-larper");
}

/** Cache, settings and the tray theme; the same folder for every installed version. */
export const DATA_DIR = defaultDataDir();

// Earlier versions kept this data in <app>/.cache. Copy it over once so the first
// update to this layout keeps history and settings.
function migrateLegacyCache(): void {
  const legacy = join(APP_ROOT, ".cache");
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    if (!existsSync(legacy) || readdirSync(DATA_DIR).length > 0) return;
    for (const name of readdirSync(legacy)) {
      const from = join(legacy, name);
      if (statSync(from).isFile()) copyFileSync(from, join(DATA_DIR, name));
    }
  } catch {
    // Starting fresh is fine; the data is a cache.
  }
}
migrateLegacyCache();

export const dataPath = (name: string) => join(DATA_DIR, name);
