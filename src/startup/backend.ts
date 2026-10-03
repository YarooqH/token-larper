// Shared shape of the per-OS startup code (windows.ts, macos.ts, linux.ts).

import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

export type StartupPlatform = "windows" | "macos" | "linux";

/** What the OS has registered to start Token Larper at login. */
export interface EntryState {
  /** The command the entry runs, for display; null when there is no entry. */
  entry: string | null;
  /** The program the entry runs (the Bun binary); null when there is no entry or the OS runs a fixed one. */
  runner: string | null;
  /** The launcher file it starts (scripts/launch-silent.vbs or bin/cli.js). */
  target: string | null;
  /** The entry exists, but the user turned it off in the OS's own settings. */
  disabledBySystem: boolean;
}

export interface StartupBackend {
  platform: StartupPlatform;
  /** Registry value, LaunchAgent plist or autostart .desktop file. */
  entryPath: string;
  /** This copy's launcher; an entry is this copy's when its target is this file. */
  launcherPath: string;
  /** Throws when this copy can't be started at login. */
  assertCanEnable(): void;
  read(): Promise<EntryState>;
  /** Create or overwrite the entry so it starts this copy. */
  write(): Promise<void>;
  remove(): Promise<void>;
}

export const NO_ENTRY: Readonly<EntryState> = Object.freeze({ entry: null, runner: null, target: null, disabledBySystem: false });

export function samePath(a: string, b: string, platform: StartupPlatform): boolean {
  return platform === "windows" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Whether the app runs from a folder the OS clears: bunx unpacks into the temp folder
 * (bunx-<uid>-<package>@<version>), which Linux empties at boot and macOS prunes.
 */
export function isTemporaryInstall(appRoot: string, tmpDir: string): boolean {
  const clean = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = clean(appRoot);
  const tmp = clean(tmpDir);
  if (tmp !== "" && (root === tmp || root.startsWith(`${tmp}/`))) return true;
  return root.split("/").some((segment) => segment.startsWith("bunx-"));
}

function resolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Refuse to point a login entry at a folder the OS clears. macOS and Linux only. */
export function assertPermanentInstall(appRoot: string, tmpDir: string = tmpdir()): void {
  // macOS /var is a symlink to /private/var, so compare real paths.
  if (!isTemporaryInstall(resolved(appRoot), resolved(tmpDir))) return;
  throw new Error(
    "Start at login needs a permanent install. This copy runs from a temporary bunx folder that your system clears, " +
      "so it wouldn't start after a restart. " +
      'Install it with "bun add -g token-larper", start it with "token-larper", then turn this on again.',
  );
}

/** The cli.js a login command `<bun> <cli.js> --boot` starts, or null for anything else. */
export function bootTarget(args: string[] | null): string | null {
  return args && args.length === 3 && args[2] === "--boot" ? args[1]! : null;
}

export function displayCommand(args: string[]): string {
  return args.map((a) => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
}
