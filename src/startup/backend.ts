// Shared shape of the per-OS startup code (windows.ts, macos.ts, linux.ts).

export type StartupPlatform = "windows" | "macos" | "linux";

/** What the OS has registered to start Token Larper at login. */
export interface EntryState {
  /** The command the entry runs, for display; null when there is no entry. */
  entry: string | null;
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

export const NO_ENTRY: EntryState = { entry: null, target: null, disabledBySystem: false };

export function samePath(a: string, b: string, platform: StartupPlatform): boolean {
  return platform === "windows" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The cli.js a login command `<bun> <cli.js> --boot` starts, or null for anything else. */
export function bootTarget(args: string[] | null): string | null {
  return args && args.length === 3 && args[2] === "--boot" ? args[1]! : null;
}

export function displayCommand(args: string[]): string {
  return args.map((a) => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
}
