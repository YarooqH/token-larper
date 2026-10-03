import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { APP_ROOT } from "../paths.ts";
import { bootTarget, displayCommand, NO_ENTRY, type EntryState, type StartupBackend } from "./backend.ts";
import { autostartDir, buildDesktopEntry, DESKTOP_FILE_NAME, parseDesktopEntry } from "./desktopEntry.ts";

const DESKTOP_PATH = posix.join(autostartDir({ XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }, homedir()), DESKTOP_FILE_NAME);
const CLI_JS = join(APP_ROOT, "bin", "cli.js");

export const linuxBackend: StartupBackend = {
  platform: "linux",
  entryPath: DESKTOP_PATH,
  launcherPath: CLI_JS,
  assertCanEnable() {
    if (!existsSync(CLI_JS)) throw new Error(`Token Larper's launcher is missing (${CLI_JS})`);
  },
  async read(): Promise<EntryState> {
    if (!existsSync(DESKTOP_PATH)) return NO_ENTRY;
    const parsed = parseDesktopEntry(readFileSync(DESKTOP_PATH, "utf8"));
    return {
      entry: parsed.args ? displayCommand(parsed.args) : "Unreadable autostart file",
      target: bootTarget(parsed.args),
      disabledBySystem: parsed.disabled,
    };
  },
  async write() {
    mkdirSync(posix.dirname(DESKTOP_PATH), { recursive: true });
    writeFileSync(DESKTOP_PATH, buildDesktopEntry({ bun: process.execPath, cliJs: CLI_JS }), "utf8");
  },
  async remove() {
    rmSync(DESKTOP_PATH, { force: true });
  },
};
