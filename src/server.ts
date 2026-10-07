import "./logFile.ts";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildClientBundle, PREBUILT_CLIENT } from "./clientBuild.ts";
import { getDashboardData, stopCcusageRuns, withPricing } from "./ccusage.ts";
import { getStartupStatus, repointStartupIfStale, setStartupStatus } from "./startup.ts";
import { getThroughput } from "./throughput/index.ts";
import { startSystemTray, stopSystemTray } from "./tray.ts";
import { buildTrayStatus, parseTheme, saveTheme } from "./trayStatus.ts";
import { logoSvgFile } from "./client/logoMark.ts";
import { appleTouchIconPng, faviconIco } from "./icons.ts";
import { APP_VERSION, RUNNING_FROM_SOURCE } from "./paths.ts";
import { checkForUpdates, compareVersions, localStatus, startUpdate } from "./updates.ts";

const ROOT_DIR = resolve(import.meta.dir, "..");
const CLIENT_DIR = join(ROOT_DIR, "src", "client");
const PORT = Number(process.env.PORT || 4269);

// The published package ships the dashboard prebuilt, so it needs neither React nor a
// build at startup. A git checkout ignores any dist/ left behind and builds src/client
// itself, so edits show up on reload.
const prebuiltClient = !RUNNING_FROM_SOURCE && existsSync(PREBUILT_CLIENT) ? Bun.file(PREBUILT_CLIENT) : null;
const clientBundle = prebuiltClient ? null : buildClientBundle();

// Only this machine's own dashboard may talk to the server. Checking Host blocks
// DNS-rebinding reads; checking Origin + Content-Type blocks cross-site POSTs.
function isAllowedHost(host: string | null, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function isAllowedMutation(req: Request, port: number): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (!isAllowedHost(new URL(origin).host, port)) return false;
    } catch {
      return false;
    }
  }
  // The tray (PowerShell) sends no Origin; a JSON content type still can't be sent cross-site without a preflight.
  return (req.headers.get("content-type") || "").toLowerCase().startsWith("application/json");
}

function openDashboard(port: number) {
  if (process.env.TOKEN_LARPER_NO_BROWSER === "1") return;
  const cmd =
    process.platform === "win32"
      ? `start http://localhost:${port}`
      : process.platform === "darwin"
      ? `open http://localhost:${port}`
      : `xdg-open http://localhost:${port}`;
  import("node:child_process").then(({ exec }) => exec(cmd, { windowsHide: true }));
}

/** The version of a Token Larper already on the port, "0.0.0" for one too old to say, or null if none. */
async function runningVersion(port: number): Promise<string | null> {
  // /api/version answers instantly; versions before 1.5.0 don't have it, so fall back to
  // /api/tray-status, which can take a few seconds while usage data loads.
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(1500) });
    const body = (await res.json().catch(() => null)) as { current?: unknown } | null;
    if (res.ok && typeof body?.current === "string") return body.current;
  } catch {
    // Nothing on the port, or it is busy; the next check decides.
  }
  try {
    const status = await fetch(`http://127.0.0.1:${port}/api/tray-status`, { signal: AbortSignal.timeout(5000) });
    return status.ok ? "0.0.0" : null;
  } catch {
    return null;
  }
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  while (true) {
    try {
      Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response() }).stop(true);
      return true;
    } catch {
      if (Date.now() > deadline) return false;
      if (!announced) console.log(`Waiting for port ${port} to be released...`);
      announced = true;
      await Bun.sleep(500);
    }
  }
}

// A newer copy (after an update, or a fresh npx run) replaces an older one on the
// same port. The same or a newer version already running just gets opened.
const running = await runningVersion(PORT);
if (running !== null && compareVersions(running, APP_VERSION) < 0) {
  console.log(`⬆️  Replacing Token Larper ${running} with ${APP_VERSION}...`);
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // It may exit before answering.
  }
  for (let i = 0; i < 40 && (await runningVersion(PORT)) !== null; i++) await Bun.sleep(250);
  // The old copy can stop answering before its port is free: on Windows, processes it
  // started hold the socket until they exit. Wait for the port rather than moving to the
  // next one, which the open dashboard isn't watching.
  if (!(await waitForPort(PORT, 90_000))) console.warn(`Port ${PORT} is still taken after 90 s.`);
} else if (running !== null) {
  console.log(`🔥 Token Larper is already running at http://localhost:${PORT}`);
  console.log(`🚀 Opening dashboard in your default browser...`);
  openDashboard(PORT);
  await Bun.sleep(300);
  process.exit(0);
}

// Warm cached usage before the first dashboard request.
void getDashboardData();

function startServer(preferredPort: number) {
  let port = preferredPort;
  while (port < preferredPort + 10) {
    try {
      return Bun.serve({
        port,
        hostname: "127.0.0.1",
        idleTimeout: 120,
        async fetch(req) {
          const url = new URL(req.url);
          const activePort = server?.port ?? port;

          if (!isAllowedHost(req.headers.get("host"), activePort)) {
            return new Response("Forbidden", { status: 403 });
          }
          if (req.method !== "GET" && req.method !== "HEAD" && !isAllowedMutation(req, activePort)) {
            return new Response("Forbidden", { status: 403 });
          }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(join(CLIENT_DIR, "index.html")), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/styles.css") {
      return new Response(Bun.file(join(CLIENT_DIR, "styles.css")), {
        headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    if (url.pathname === "/logo.svg") {
      return new Response(logoSvgFile(), {
        headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
      });
    }

    if (url.pathname === "/favicon.ico") {
      return new Response(faviconIco(), {
        headers: { "Content-Type": "image/x-icon", "Cache-Control": "public, max-age=86400" },
      });
    }

    if (url.pathname === "/apple-touch-icon.png" || url.pathname === "/apple-touch-icon-precomposed.png") {
      return new Response(appleTouchIconPng(), {
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
      });
    }

    if (url.pathname === "/app.js") {
      const code = prebuiltClient
        ?? (process.env.NODE_ENV === "production" ? await clientBundle! : await buildClientBundle());
      return new Response(code, {
        headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    if (url.pathname === "/api/usage" && req.method === "GET") {
      const refresh = url.searchParams.get("refresh") === "1";
      const forceDeepScan = url.searchParams.get("deep") === "1";
      const data = await getDashboardData({ refresh, forceDeepScan });
      return Response.json(withPricing(data));
    }

    if (url.pathname === "/api/throughput" && req.method === "GET") {
      const wait = url.searchParams.get("wait") === "1" ? 15_000 : 0;
      return Response.json(await getThroughput(wait));
    }

    if (url.pathname === "/api/tray-status" && req.method === "GET") {
      const [data, startup] = await Promise.all([
        getDashboardData({ refresh: false }),
        getStartupStatus(PORT),
      ]);
      return Response.json(buildTrayStatus(data, startup));
    }

    // The dashboard reports its resolved theme colors so the tray popup can match them.
    if (url.pathname === "/api/ui-theme" && req.method === "POST") {
      const next = parseTheme(await req.json().catch(() => null));
      if (!next) return Response.json({ error: "Expected #rrggbb colors" }, { status: 400 });
      saveTheme(next);
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/startup" && req.method === "GET") {
      const status = await getStartupStatus(PORT);
      return Response.json(status);
    }

    if (url.pathname === "/api/startup" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return Response.json({ error: "Startup settings must be an object" }, { status: 400 });
      }
      const input = body as { enabled?: unknown; openBrowserOnBoot?: unknown };
      if (typeof input.enabled !== "boolean" ||
          (input.openBrowserOnBoot !== undefined && typeof input.openBrowserOnBoot !== "boolean")) {
        return Response.json({ error: "Startup settings must use boolean values" }, { status: 400 });
      }
      try {
        const status = await setStartupStatus({
          enabled: input.enabled,
          openBrowserOnBoot: input.openBrowserOnBoot as boolean | undefined,
          port: PORT,
        });
        return Response.json(status);
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not update startup" }, { status: 500 });
      }
    }

    if (url.pathname === "/api/version" && req.method === "GET") {
      // Only a request from the dashboard reaches out to npm.
      if (url.searchParams.get("check") !== "1") return Response.json(localStatus());
      return Response.json(await checkForUpdates(url.searchParams.get("force") === "1"));
    }

    if (url.pathname === "/api/update" && req.method === "POST") {
      if (RUNNING_FROM_SOURCE) {
        return Response.json({ error: "This copy runs from a git checkout. Update it with git pull." }, { status: 409 });
      }
      try {
        const status = await checkForUpdates();
        if (!status.updateAvailable || !status.latest) {
          return Response.json({ error: status.error ?? "Already on the latest version." }, { status: 409 });
        }
        startUpdate(activePort, status.latest);
        return Response.json({ ok: true, version: status.latest });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not start the update" }, { status: 500 });
      }
    }

    if (url.pathname === "/api/shutdown" && req.method === "POST") {
      setTimeout(() => {
        stopCcusageRuns();
        stopSystemTray();
        server.stop(true);
        process.exit(0);
      }, 150);
      return Response.json({ ok: true, message: "Shutting down Token Larper..." });
    }

          return new Response("Not Found", { status: 404 });
        },
      });
    } catch (err: any) {
      if (err?.code === "EADDRINUSE" || String(err).includes("EADDRINUSE")) {
        console.warn(`Port ${port} in use, trying port ${port + 1}...`);
        port++;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not find an open port starting from ${preferredPort}`);
}

const server = startServer(PORT);
startSystemTray(server.port ?? PORT);
void repointStartupIfStale();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopCcusageRuns();
    stopSystemTray();
    process.exit(0);
  });
}

console.log(`🔥 Token Larper running at http://localhost:${server.port} (System Tray Icon Active)`);
