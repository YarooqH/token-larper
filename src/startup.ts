import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { StartupConfig } from "./types.ts";

const REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const REG_VALUE_NAME = "TokenLarper";
const ROOT_DIR = resolve(import.meta.dir, "..");
const SETTINGS_FILE = join(ROOT_DIR, ".cache", "settings.json");
const VBS_LAUNCHER = join(ROOT_DIR, "scripts", "launch-silent.vbs");
const PS1_RUNNER = join(ROOT_DIR, "scripts", "run-server.ps1");

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
  mkdirSync(join(ROOT_DIR, ".cache"), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

async function runReg(args: string[]): Promise<{ code: number; output: string; error: string }> {
  const proc = Bun.spawn(["reg.exe", ...args], { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output, error };
}

async function readRegistryValue(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const result = await runReg(["query", REG_KEY, "/v", REG_VALUE_NAME]);
  if (result.code !== 0) return null;
  const line = result.output.split(/\r?\n/).find((part) =>
    new RegExp(`^\\s*${REG_VALUE_NAME}\\s+REG_\\w+\\s+`, "i").test(part)
  );
  return line?.match(/^\s*\S+\s+REG_\w+\s+(.+)$/i)?.[1]?.trim() ?? null;
}

export async function getStartupStatus(defaultPort = 4269): Promise<StartupConfig> {
  const saved = loadSavedSettings(defaultPort);
  let registryValue: string | null = null;
  try {
    registryValue = await readRegistryValue();
  } catch {
    // Status remains readable if reg.exe is unavailable.
  }
  const expected = `wscript.exe //B //Nologo "${VBS_LAUNCHER}"`;
  return {
    enabled: registryValue?.toLowerCase() === expected.toLowerCase(),
    openBrowserOnBoot: saved.openBrowserOnBoot,
    port: defaultPort,
    registryValue,
    launcherPath: VBS_LAUNCHER,
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

  if (options.enabled && (!existsSync(VBS_LAUNCHER) || !existsSync(PS1_RUNNER))) {
    throw new Error("The Windows startup launcher is missing");
  }

  if (process.platform === "win32") {
    if (options.enabled) {
      const command = `wscript.exe //B //Nologo "${VBS_LAUNCHER}"`;
      const result = await runReg([
        "add", REG_KEY, "/v", REG_VALUE_NAME, "/t", "REG_SZ", "/d", command, "/f",
      ]);
      if (result.code !== 0) throw new Error(result.error.trim() || "Could not enable Windows startup");
    } else if (await readRegistryValue()) {
      const result = await runReg(["delete", REG_KEY, "/v", REG_VALUE_NAME, "/f"]);
      if (result.code !== 0) throw new Error(result.error.trim() || "Could not disable Windows startup");
    }
  }

  saveSettings(next);
  return getStartupStatus(next.port);
}
