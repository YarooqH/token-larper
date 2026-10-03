import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { APP_ROOT, dataPath } from "../paths.ts";
import { assertPermanentInstall, bootTarget, displayCommand, NO_ENTRY, type EntryState, type StartupBackend } from "./backend.ts";
import { buildPlist, isLabelDisabled, LAUNCH_AGENT_LABEL, parsePlistArgs } from "./launchAgent.ts";
import { run } from "./run.ts";

const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
const CLI_JS = join(APP_ROOT, "bin", "cli.js");

/** Turning the item off in System Settings → Login Items shows up as a disabled label. */
async function turnedOffInSystemSettings(): Promise<boolean> {
  const uid = process.getuid?.();
  if (uid === undefined) return false;
  try {
    const result = await run(["launchctl", "print-disabled", `gui/${uid}`]);
    return result.code === 0 && isLabelDisabled(result.output);
  } catch {
    return false;
  }
}

export const macosBackend: StartupBackend = {
  platform: "macos",
  entryPath: PLIST_PATH,
  launcherPath: CLI_JS,
  assertCanEnable() {
    if (!existsSync(CLI_JS)) throw new Error(`Token Larper's launcher is missing (${CLI_JS})`);
    assertPermanentInstall(APP_ROOT);
  },
  async read(): Promise<EntryState> {
    if (!existsSync(PLIST_PATH)) return NO_ENTRY;
    const args = parsePlistArgs(readFileSync(PLIST_PATH, "utf8"));
    return {
      entry: args ? displayCommand(args) : "Unreadable LaunchAgent file",
      runner: args?.[0] ?? null,
      target: bootTarget(args),
      disabledBySystem: await turnedOffInSystemSettings(),
    };
  },
  // macOS shows "Background Items Added" for a new agent; that notice is the user's to see.
  async write() {
    mkdirSync(dirname(PLIST_PATH), { recursive: true });
    writeFileSync(PLIST_PATH, buildPlist({ bun: process.execPath, cliJs: CLI_JS, logFile: dataPath("login-agent.log") }), "utf8");
  },
  // Removing the file is enough: a RunAtLoad agent only runs when loaded at login, and
  // unloading it (launchctl bootout) could signal the server that is running now.
  async remove() {
    rmSync(PLIST_PATH, { force: true });
  },
};
