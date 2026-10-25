import type { LiveSnapshot, LiveUpdate, StartupConfig, UpdateStatus } from "../src/types.ts";
import { dashboardFixture, limitsFixture, liveEvent, throughputFixture, tools } from "./fixtures.ts";

// Stands in for the local server, so the dashboard runs as static files on GitHub Pages.
// It answers the dashboard's /api/* requests from the sample data and leaves every other
// request alone.

declare const DEMO_VERSION: string;

const LIVE_WINDOW_MS = 60 * 60_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let dashboard: ReturnType<typeof dashboardFixture> | null = null;
let throughput: ReturnType<typeof throughputFixture> | null = null;
let privacy = { offline: false, locked: false };
let startup: StartupConfig = { enabled: false, openBrowserOnBoot: false, port: 4269, registryValue: null, launcherPath: "Live demo" };

async function handle(path: string, method: string, body: string | undefined): Promise<Response> {
  // A short pause, so loading states show the way they do against a real server.
  await wait(80);
  const input = body ? JSON.parse(body) : {};
  switch (`${method} ${path}`) {
    case "GET /api/usage":
      return json((dashboard ??= dashboardFixture()));
    case "GET /api/throughput":
      return json((throughput ??= throughputFixture()));
    case "GET /api/limits":
      return json(limitsFixture());
    case "GET /api/startup":
      return json(startup);
    case "POST /api/startup":
      startup = { ...startup, enabled: Boolean(input.enabled), openBrowserOnBoot: Boolean(input.openBrowserOnBoot ?? startup.openBrowserOnBoot) };
      return json(startup);
    case "GET /api/privacy":
      return json(privacy);
    case "POST /api/privacy":
      privacy = { ...privacy, offline: Boolean(input.offline) };
      return json(privacy);
    case "GET /api/version": {
      const status: UpdateStatus = { current: DEMO_VERSION, latest: DEMO_VERSION, updateAvailable: false, checkedAt: new Date().toISOString(), source: "npm" };
      return json(status);
    }
    case "POST /api/update":
      return json({ error: "This is the live demo. Run bunx token-larper to install the real thing." }, 409);
    case "POST /api/ui-theme":
    case "POST /api/shutdown":
      return json({ ok: true });
    default:
      return json({ error: "Not in the demo" }, 404);
  }
}

const realFetch = window.fetch.bind(window);
window.fetch = async function demoFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), location.href);
  const api = url.origin === location.origin ? url.pathname.match(/\/api\/[a-z-]+$/)?.[0] : undefined;
  if (!api) return realFetch(input, init);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : request ? await request.text() : undefined;
  return handle(api, method, body || undefined);
} as typeof window.fetch;

/** Live mode's feed: an hour of responses, then a new one every few seconds. */
class DemoEventSource extends EventTarget {
  readonly url: string;
  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    if (!/\/api\/live$/.test(new URL(this.url, location.href).pathname)) {
      return new RealEventSource(url) as unknown as DemoEventSource;
    }
    setTimeout(() => this.start(), 150);
  }

  private start() {
    if (this.readyState === 2) return;
    this.readyState = 1;
    const now = Date.now();
    // Busy stretches and quiet ones, like a real hour of work.
    const events = [];
    for (let t = now - LIVE_WINDOW_MS + 30_000; t < now; ) {
      events.push(liveEvent(this.seq++, t));
      t += Math.floor(t / 600_000) % 3 === 0 ? 150_000 : 6_000 + ((this.seq * 7_919) % 30_000);
    }
    const snapshot: LiveSnapshot = { windowMs: LIVE_WINDOW_MS, tools: tools.map((tool) => tool.id), files: 3, events };
    this.dispatchEvent(new MessageEvent("snapshot", { data: JSON.stringify(snapshot) }));
    this.next();
  }

  private next() {
    this.timer = setTimeout(() => {
      if (this.readyState === 2) return;
      const update: LiveUpdate = { files: 3, events: [liveEvent(this.seq++, Date.now())] };
      this.dispatchEvent(new MessageEvent("update", { data: JSON.stringify(update) }));
      this.next();
    }, 1_500 + ((this.seq * 4_271) % 3_000));
  }

  close() {
    this.readyState = 2;
    clearTimeout(this.timer);
  }
}

const RealEventSource = window.EventSource;
window.EventSource = DemoEventSource as unknown as typeof EventSource;
