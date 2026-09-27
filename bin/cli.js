#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const serverScript = join(rootDir, "src", "server.ts");

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
    console.error("\nMore info: https://github.com/YarooqH/tokenlarper\n");
    process.exit(1);
  }
}
