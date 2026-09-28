#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const serverScript = join(rootDir, "src", "server.ts");

// Check if Token Larper is already running on the requested port
const port = process.env.PORT || 4269;
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/tray-status`, {
    signal: AbortSignal.timeout(600),
  });
  if (res.ok) {
    console.log(`🔥 Token Larper is already running at http://localhost:${port}`);
    console.log(`🚀 Opening dashboard in your default browser...`);
    const cmd =
      process.platform === "win32"
        ? `start http://localhost:${port}`
        : process.platform === "darwin"
        ? `open http://localhost:${port}`
        : `xdg-open http://localhost:${port}`;
    const { exec } = await import("node:child_process");
    exec(cmd);
    process.exit(0);
  }
} catch {
  // Server is not running yet, proceed with startup
}

// If executed directly inside Bun runtime
if (typeof Bun !== "undefined") {
  await import(serverScript);
} else {
  // If executed via Node / npx, check for Bun and hand over
  const bunCheck = spawnSync("bun", ["--version"], { stdio: "ignore" });
  if (bunCheck.status === 0) {
    const child = spawnSync("bun", [serverScript, ...process.argv.slice(2)], {
      stdio: "inherit",
      cwd: rootDir,
    });
    process.exit(child.status ?? 0);
  } else {
    console.error("🔥 Token Larper requires Bun (v1.1+) to run.");
    console.error("\nInstall Bun with one command:");
    if (process.platform === "win32") {
      console.error('  powershell -c "irm bun.sh/install.ps1 | iex"');
    } else {
      console.error("  curl -fsSL https://bun.sh/install | bash");
    }
    console.error("\nMore info: https://github.com/YarooqH/token-larper\n");
    process.exit(1);
  }
}
