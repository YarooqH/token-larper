import { existsSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT } from "../paths.ts";
import { NO_ENTRY, type EntryState, type StartupBackend } from "./backend.ts";
import { run } from "./run.ts";

const REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const REG_VALUE_NAME = "TokenLarper";
const VBS_LAUNCHER = join(APP_ROOT, "scripts", "launch-silent.vbs");
const PS1_RUNNER = join(APP_ROOT, "scripts", "run-server.ps1");
const COMMAND = `wscript.exe //B //Nologo "${VBS_LAUNCHER}"`;

async function readRegistryValue(): Promise<string | null> {
  const result = await run(["reg.exe", "query", REG_KEY, "/v", REG_VALUE_NAME]);
  if (result.code !== 0) return null;
  const line = result.output.split(/\r?\n/).find((part) =>
    new RegExp(`^\\s*${REG_VALUE_NAME}\\s+REG_\\w+\\s+`, "i").test(part)
  );
  return line?.match(/^\s*\S+\s+REG_\w+\s+(.+)$/i)?.[1]?.trim() ?? null;
}

export const windowsBackend: StartupBackend = {
  platform: "windows",
  entryPath: `${REG_KEY}\\${REG_VALUE_NAME}`,
  launcherPath: VBS_LAUNCHER,
  assertCanEnable() {
    if (!existsSync(VBS_LAUNCHER) || !existsSync(PS1_RUNNER)) throw new Error("The Windows startup launcher is missing");
  },
  async read(): Promise<EntryState> {
    const value = await readRegistryValue();
    if (!value) return NO_ENTRY;
    return { entry: value, runner: null, target: value.match(/"([^"]*launch-silent\.vbs)"/i)?.[1] ?? null, disabledBySystem: false };
  },
  async write() {
    const result = await run(["reg.exe", "add", REG_KEY, "/v", REG_VALUE_NAME, "/t", "REG_SZ", "/d", COMMAND, "/f"]);
    if (result.code !== 0) throw new Error(result.error.trim() || "Could not enable Windows startup");
  },
  async remove() {
    const result = await run(["reg.exe", "delete", REG_KEY, "/v", REG_VALUE_NAME, "/f"]);
    if (result.code !== 0) throw new Error(result.error.trim() || "Could not disable Windows startup");
  },
};
