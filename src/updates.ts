import { spawn } from "node:child_process";
import { APP_VERSION, RUNNING_FROM_SOURCE } from "./paths.ts";
import { compareVersions } from "./semver.ts";
import type { UpdateStatus } from "./types.ts";

export { compareVersions };

// Token Larper's own update check. It runs only when the dashboard asks (on open, if
// automatic checks are on, or from Settings) and sends nothing but the package name.

const PACKAGE = "token-larper";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
const RECHECK_MS = 6 * 60 * 60 * 1000;

let lastCheck: { latest: string; at: number } | null = null;
let inFlight: Promise<void> | null = null;

async function fetchLatest(): Promise<void> {
  const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`npm registry responded ${res.status}`);
  const body = (await res.json()) as { version?: unknown };
  if (typeof body.version !== "string") throw new Error("npm registry response had no version");
  lastCheck = { latest: body.version, at: Date.now() };
}

export function localStatus(): UpdateStatus {
  const latest = lastCheck?.latest ?? null;
  return {
    current: APP_VERSION,
    latest,
    updateAvailable: latest !== null && compareVersions(latest, APP_VERSION) > 0,
    checkedAt: lastCheck ? new Date(lastCheck.at).toISOString() : null,
    source: RUNNING_FROM_SOURCE ? "source" : "npm",
  };
}

/** Check npm (at most every few hours unless forced) and report. */
export async function checkForUpdates(force = false): Promise<UpdateStatus> {
  if (force || !lastCheck || Date.now() - lastCheck.at > RECHECK_MS) {
    inFlight ??= fetchLatest().finally(() => (inFlight = null));
    try {
      await inFlight;
    } catch (error) {
      return { ...localStatus(), error: error instanceof Error ? error.message : "Could not reach npm" };
    }
  }
  return localStatus();
}

/**
 * Run a program in the background, independent of this server.
 *
 * On Windows every child of this server inherits its listening socket, which keeps the
 * port taken until the child exits. Start-Process launches the program through the shell
 * instead, so it inherits nothing, and gives it a hidden console that anything it starts
 * shares instead of opening windows of their own. Arguments must not contain double quotes.
 */
export function launchIndependent(program: string, args: string[], env: Record<string, string | undefined>): void {
  if (process.platform === "win32") {
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const command = `Start-Process -WindowStyle Hidden -FilePath ${quote(program)} -ArgumentList ${args.map((a) => quote(`"${a}"`)).join(",")}`;
    // Not detached: a PowerShell without any console fails to start the program.
    spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      stdio: "ignore",
      windowsHide: true,
      env,
    }).unref();
    return;
  }
  spawn(program, args, { detached: true, stdio: "ignore", env }).unref();
}

/**
 * Start the given version in the background. The new copy sees this server running an
 * older version, asks it to shut down, and takes over the same port (src/server.ts).
 * The exact version is installed because `@latest` can resolve from bun's cached
 * package list and bring back the version already running.
 */
export function startUpdate(port: number, version: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) throw new Error(`Unexpected version "${version}"`);
  launchIndependent(process.execPath, ["x", `${PACKAGE}@${version}`], {
    ...process.env,
    PORT: String(port),
    TOKEN_LARPER_NO_BROWSER: "1",
  });
}
