#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const serverScript = join(rootDir, "src", "server.ts");
const port = Number(process.env.PORT || 4269);
const args = process.argv.slice(2);

const HELP = `Token Larper: a local dashboard for AI coding token usage.

Usage:
  token-larper                Start in the background and open the dashboard
  token-larper --foreground   Run in this terminal and show logs (Ctrl+C stops it)
  token-larper --no-open      Start without opening the browser
  token-larper --boot         What the login entry runs: start with the saved port and browser setting
  token-larper stop           Stop the running copy

Environment: PORT (default 4269), TOKEN_LARPER_DATA_DIR, NO_TRAY=1`;

// Same folder as src/paths.ts; the background server's log goes there.
function dataDir() {
  if (process.env.TOKEN_LARPER_DATA_DIR) return resolve(process.env.TOKEN_LARPER_DATA_DIR);
  const home = homedir();
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "TokenLarper");
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "TokenLarper");
  return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "token-larper");
}

function bunPath() {
  if (typeof Bun !== "undefined") return process.execPath;
  if (spawnSync("bun", ["--version"], { stdio: "ignore", windowsHide: true }).status === 0) return "bun";
  console.error("🔥 Token Larper runs on Bun (v1.1+), and Bun isn't installed.");
  console.error("\n1. Install Bun:");
  if (process.platform === "win32") {
    console.error('     powershell -c "irm bun.sh/install.ps1 | iex"');
  } else {
    console.error("     curl -fsSL https://bun.sh/install | bash");
  }
  console.error("\n2. Restart your terminal, then run:");
  console.error("     bunx token-larper");
  console.error("\nMore info: https://github.com/YarooqH/token-larper#quick-start\n");
  process.exit(1);
}

async function isRunning(p) {
  try {
    const res = await fetch(`http://127.0.0.1:${p}/api/tray-status`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const [cmd, cmdArgs] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  spawn(cmd, cmdArgs, { stdio: "ignore", detached: true, windowsHide: true }).unref();
}

// The settings the dashboard saves (src/startup.ts); read at login so the entry never changes.
function savedSettings() {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir(), "settings.json"), "utf8"));
    const saved = Number(raw.port);
    return {
      port: Number.isInteger(saved) && saved > 0 && saved <= 65535 ? saved : 4269,
      openOnBoot: raw.openBrowserOnBoot === true,
    };
  } catch {
    return { port: 4269, openOnBoot: false };
  }
}

/** The login entry on macOS and Linux runs this; scripts/run-server.ps1 does the same on Windows. */
async function boot() {
  const { port: bootPort, openOnBoot } = savedSettings();
  if (await isRunning(bootPort)) {
    if (openOnBoot) openBrowser(`http://localhost:${bootPort}`);
    process.exit(0);
  }
  process.env.PORT = String(bootPort);
  await background(openOnBoot, { boot: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stop() {
  try {
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    console.log(`Token Larper isn't running on port ${port}.`);
    return;
  }
  for (let i = 0; i < 20 && (await isRunning(port)); i++) await sleep(250);
  console.log("Stopped Token Larper.");
}

async function foreground() {
  if (typeof Bun !== "undefined") return import(serverScript);
  const child = spawnSync("bun", [serverScript], { stdio: "inherit", cwd: rootDir });
  process.exit(child.status ?? 0);
}

/**
 * Start the server so it outlives this terminal. On Windows it goes through Start-Process:
 * the server then gets a hidden console that everything it starts shares (a process with
 * no console at all makes Windows open a window for each console program it runs), and it
 * inherits no handles, so it can't end up holding an older copy's port when this CLI was
 * itself started by one during an update. The server writes its own log (src/logFile.ts).
 */
function startServerProcess(bun, env) {
  if (process.platform === "win32") {
    const quote = (value) => `'${value.replace(/'/g, "''")}'`;
    const command = [
      "Start-Process -WindowStyle Hidden",
      `-FilePath ${quote(bun)}`,
      `-ArgumentList ${quote(`"${serverScript}"`)}`,
      `-WorkingDirectory ${quote(rootDir)}`,
    ].join(" ");
    const hop = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      stdio: "ignore",
      windowsHide: true,
      env,
    });
    return hop.status === 0;
  }
  spawn(bun, [serverScript], { cwd: rootDir, detached: true, stdio: "ignore", env }).unref();
  return true;
}

async function background(open, { boot = false } = {}) {
  const bun = bunPath();
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, "server.log");
  const errorLog = join(dir, "startup-error.log");
  closeSync(openSync(logFile, "w"));

  // The server moves to the next free port if another program has this one, and takes
  // over from an older Token Larper on the same port (see src/server.ts).
  const started = startServerProcess(bun, {
    ...process.env,
    TOKEN_LARPER_NO_BROWSER: "1",
    TOKEN_LARPER_LOG_FILE: logFile,
  });

  const readLog = () => {
    try {
      return readFileSync(logFile, "utf8");
    } catch {
      return "";
    }
  };

  // Ready once the server says where it is listening. A copy of the same version that
  // is already running says so too ("already running at ..."), then the new one exits.
  let url = null;
  let waitingForPort = false;
  for (let i = 0; started && i < 120 && !url; i++) {
    await sleep(250);
    const text = readLog();
    url = text.match(/running at (http:\/\/localhost:\d+)/)?.[1] ?? null;
    // Taking over from an older copy can take a minute while its port is released. This
    // CLI may be holding that port itself (when the old copy started it for an update),
    // so leave now instead of waiting.
    waitingForPort = !url && text.includes("Waiting for port");
    if (waitingForPort) break;
    if (/Token Larper stopped:/.test(text)) break;
  }

  if (waitingForPort) {
    console.log(`🔥 Token Larper is replacing an older copy. It will be at http://localhost:${process.env.PORT || port} in a minute.`);
    process.exit(0);
  }

  if (!url) {
    if (boot) writeFileSync(errorLog, `Token Larper didn't start at login. See ${logFile}\n`, "utf8");
    console.error("🔥 Token Larper didn't start.");
    const tail = readLog().trim().split(/\r?\n/).slice(-15).join("\n");
    if (tail) console.error(`\n${tail}\n`);
    console.error(`Full log: ${logFile}`);
    console.error("Run with --foreground to see the server output live.");
    process.exit(1);
  }

  if (boot) rmSync(errorLog, { force: true });

  console.log(`🔥 Token Larper is running at ${url}`);
  console.log("   It keeps running after you close this window.");
  console.log(
    process.platform === "win32"
      ? "   Quit it from the tray icon, or run: bunx token-larper stop"
      : "   Stop it with: bunx token-larper stop"
  );
  if (open) openBrowser(url);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
} else if (args[0] === "stop") {
  await stop();
} else if (args.includes("--boot")) {
  await boot();
} else if (args.includes("--foreground") || args.includes("-f")) {
  bunPath();
  await foreground();
} else {
  await background(!args.includes("--no-open") && process.env.TOKEN_LARPER_NO_BROWSER !== "1");
}
