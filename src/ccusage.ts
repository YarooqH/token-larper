import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  DashboardPayload,
  HarnessId,
  HarnessMetadata,
  HarnessSummary,
  ModelMetric,
  PeriodHarnessBreakdown,
  SessionEntry,
  TimePeriodRow,
} from "./types.ts";
import { isoWeek, localDateKey } from "./client/utils.ts";
import { opencodeSessionUpdated, resolveSessionProject, saveSessionProjects } from "./projects.ts";
import { APP_ROOT, DATA_DIR } from "./paths.ts";
import { pricing, type Rates } from "./pricing.ts";

const ROOT_DIR = APP_ROOT;
const CACHE_DIR = DATA_DIR;
const DASHBOARD_CACHE_FILE = join(CACHE_DIR, "dashboard-cache.json");
const ANTIGRAVITY_DAILY_CACHE = join(CACHE_DIR, "antigravity-daily.json");
const ANTIGRAVITY_SESSION_CACHE = join(CACHE_DIR, "antigravity-session.json");

const HOME = homedir();
const APPDATA = process.env.APPDATA || join(HOME, "AppData", "Roaming");
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, "AppData", "Local");

interface HarnessDefinition {
  id: HarnessId;
  name: string;
  vendor: string;
  color: string;
  accentBg: string;
  description: string;
  configPathHint: string;
  detectPaths: string[];
  slowScan?: boolean;
}

export const HARNESS_DEFINITIONS: HarnessDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    color: "#f97316",
    accentBg: "rgba(249, 115, 22, 0.14)",
    description: "Anthropic's agentic terminal harness (~/.claude)",
    configPathHint: "~/.claude",
    detectPaths: [join(HOME, ".claude"), join(HOME, ".claude.json")],
  },
  {
    id: "codex",
    name: "Codex CLI",
    vendor: "OpenAI",
    color: "#10b981",
    accentBg: "rgba(16, 185, 129, 0.14)",
    description: "OpenAI Codex coding agent & rollout sessions (~/.codex)",
    configPathHint: "~/.codex",
    detectPaths: [join(HOME, ".codex")],
  },
  {
    id: "antigravity",
    name: "Antigravity",
    vendor: "Google DeepMind",
    color: "#8b5cf6",
    accentBg: "rgba(139, 92, 246, 0.14)",
    description: "Google DeepMind Antigravity agentic IDE & brain transcripts",
    configPathHint: "~/.gemini/antigravity",
    detectPaths: [join(HOME, ".gemini", "antigravity")],
    slowScan: true,
  },
  {
    id: "pi",
    name: "pi-agent",
    vendor: "pi",
    color: "#ec4899",
    accentBg: "rgba(236, 72, 153, 0.14)",
    description: "Pi coding harness & multi-model terminal sessions (~/.pi)",
    configPathHint: "~/.pi",
    detectPaths: [join(HOME, ".pi")],
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "SST / OpenCode",
    color: "#06b6d4",
    accentBg: "rgba(6, 182, 212, 0.14)",
    description: "Open-source terminal coding agent (opencode)",
    configPathHint: "~/.local/share/opencode",
    detectPaths: [
      join(HOME, ".local", "share", "opencode"),
      join(HOME, ".opencode"),
      join(LOCALAPPDATA, "opencode"),
    ],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    vendor: "Google",
    color: "#3b82f6",
    accentBg: "rgba(59, 130, 246, 0.14)",
    description: "Google Gemini terminal coding agent (~/.gemini)",
    configPathHint: "~/.gemini",
    detectPaths: [join(HOME, ".gemini")],
  },
  {
    id: "copilot",
    name: "GitHub Copilot CLI",
    vendor: "GitHub",
    color: "#eab308",
    accentBg: "rgba(234, 179, 8, 0.14)",
    description: "GitHub Copilot agentic CLI (~/.copilot)",
    configPathHint: "~/.copilot",
    detectPaths: [join(HOME, ".copilot")],
  },
  {
    id: "amp",
    name: "Amp",
    vendor: "Sourcegraph",
    color: "#f43f5e",
    accentBg: "rgba(244, 63, 94, 0.14)",
    description: "Sourcegraph Amp coding agent",
    configPathHint: "~/.amp",
    detectPaths: [join(HOME, ".amp"), join(LOCALAPPDATA, "amp")],
  },
  {
    id: "droid",
    name: "Droid",
    vendor: "Factory",
    color: "#14b8a6",
    accentBg: "rgba(20, 184, 166, 0.14)",
    description: "Factory Droid autonomous engineering harness",
    configPathHint: "~/.factory",
    detectPaths: [join(HOME, ".factory"), join(HOME, ".droid")],
  },
  {
    id: "codebuff",
    name: "Codebuff",
    vendor: "Codebuff",
    color: "#a855f7",
    accentBg: "rgba(168, 85, 247, 0.14)",
    description: "Codebuff CLI coding agent",
    configPathHint: "~/.codebuff",
    detectPaths: [join(HOME, ".codebuff"), join(APPDATA, "codebuff")],
  },
  {
    id: "hermes",
    name: "Hermes Agent",
    vendor: "Nous Research",
    color: "#f59e0b",
    accentBg: "rgba(245, 158, 11, 0.14)",
    description: "Hermes terminal agent harness",
    configPathHint: "~/.hermes",
    detectPaths: [join(HOME, ".hermes")],
  },
  {
    id: "goose",
    name: "Goose",
    vendor: "Block",
    color: "#6366f1",
    accentBg: "rgba(99, 102, 241, 0.14)",
    description: "Block's open-source developer agent",
    configPathHint: "~/.config/goose",
    detectPaths: [join(HOME, ".config", "goose"), join(APPDATA, "Block", "goose")],
  },
  {
    id: "kilo",
    name: "Kilo Code",
    vendor: "Kilo",
    color: "#84cc16",
    accentBg: "rgba(132, 204, 22, 0.14)",
    description: "Kilo Code agent harness",
    configPathHint: "~/.kilo",
    detectPaths: [join(HOME, ".kilo")],
  },
  {
    id: "kimi",
    name: "Kimi CLI",
    vendor: "Moonshot AI",
    color: "#22d3ee",
    accentBg: "rgba(34, 211, 238, 0.14)",
    description: "Moonshot Kimi coding agent CLI",
    configPathHint: "~/.kimi",
    detectPaths: [join(HOME, ".kimi")],
  },
  {
    id: "qwen",
    name: "Qwen Code",
    vendor: "Alibaba Cloud",
    color: "#c084fc",
    accentBg: "rgba(192, 132, 252, 0.14)",
    description: "Qwen Code CLI harness",
    configPathHint: "~/.qwen",
    detectPaths: [join(HOME, ".qwen")],
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    vendor: "OpenClaw",
    color: "#fb7185",
    accentBg: "rgba(251, 113, 133, 0.14)",
    description: "OpenClaw autonomous agent CLI",
    configPathHint: "~/.openclaw",
    detectPaths: [join(HOME, ".openclaw")],
  },
  {
    id: "grok",
    name: "Grok Build CLI",
    vendor: "xAI",
    color: "#38bdf8",
    accentBg: "rgba(56, 189, 248, 0.14)",
    description: "xAI Grok Build coding CLI",
    configPathHint: "~/.grok",
    detectPaths: [join(HOME, ".grok")],
  },
  {
    id: "zcode",
    name: "ZCode",
    vendor: "ZCode",
    color: "#4ade80",
    accentBg: "rgba(74, 222, 128, 0.14)",
    description: "ZCode CLI agent harness",
    configPathHint: "~/.zcode",
    detectPaths: [join(HOME, ".zcode")],
  },
];

function resolveCcusageBinary(): { cmd: string[]; version: string } {
  let version = "20.0.24";
  try {
    const pkgPath = join(ROOT_DIR, "node_modules", "ccusage", "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.version) version = pkg.version;
    }
  } catch {
    // ignore
  }

  const candidates = [
    join(ROOT_DIR, "node_modules", "@ccusage", "ccusage-win32-x64", "bin", "ccusage.exe"),
    join(ROOT_DIR, "node_modules", "@ccusage", "ccusage-win32-arm64", "bin", "ccusage.exe"),
    join(ROOT_DIR, "node_modules", "@ccusage", "ccusage-darwin-arm64", "bin", "ccusage"),
    join(ROOT_DIR, "node_modules", "@ccusage", "ccusage-darwin-x64", "bin", "ccusage"),
    join(ROOT_DIR, "node_modules", "@ccusage", "ccusage-linux-x64", "bin", "ccusage"),
    join(ROOT_DIR, "node_modules", "@ccusage", "ccusage-linux-arm64", "bin", "ccusage"),
  ];

  for (const bin of candidates) {
    if (existsSync(bin)) {
      return { cmd: [bin], version };
    }
  }

  const cliJs = join(ROOT_DIR, "node_modules", "ccusage", "src", "cli.js");
  if (existsSync(cliJs)) {
    return { cmd: [process.execPath, cliJs], version };
  }

  return { cmd: ["bunx", "ccusage"], version };
}

/**
 * Anthropic list prices per 1M tokens, by family and version. Opus dropped from $15/$75
 * at 4.5, so a single "opus" rate overstated newer models about threefold. Names come in
 * both orders ("claude-opus-4-1-20250805", "claude-3-5-haiku"); an unversioned name
 * gets the current price.
 */
export function claudeRates(model: string): Rates | null {
  const family = model.match(/opus|sonnet|haiku/)?.[0];
  if (!family) return null;
  // Version parts are one or two digits; longer runs are date stamps ("opus-4-20250514").
  const after = model.match(new RegExp(`${family}-(\\d{1,2})(?!\\d)(?:[-.](\\d{1,2})(?!\\d))?`));
  const before = model.match(new RegExp(`(\\d+)[-.](\\d{1,2})-${family}`));
  const parts = after ?? before;
  const version = parts ? Number(parts[1]) + Number(parts[2] ?? 0) / 10 : Infinity;

  if (family === "opus") {
    if (version >= 5.5) return [4, 20, 5, 0.2];
    if (version >= 4.5) return [5, 25, 6.25, 0.5];
    return [15, 75, 18.75, 1.5];
  }
  if (family === "sonnet") {
    if (version >= 5) return [2, 10, 2.5, 0.2];
    return [3, 15, 3.75, 0.3];
  }
  if (version >= 4.5) return [1, 5, 1.25, 0.1];
  if (version >= 3.5) return [0.8, 4, 1, 0.08];
  return [0.25, 1.25, 0.3, 0.03];
}

/**
 * Estimates realistic frontier API cost in USD when ccusage reports missingPricing: true or 0 cost
 * (e.g. for bleeding-edge models like claude-opus-5-5, gpt-6-sol, minimax-m3-free, etc.).
 * Rates come from OpenRouter's price list when it lists the model, otherwise the built-in ones below.
 */
export function estimateFrontierCost(params: {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningOutputTokens?: number;
}): number {
  const m = params.modelName.toLowerCase();
  const M = 1_000_000;

  // Pricing in USD per 1M tokens: [input, output, cacheWrite, cacheRead]
  let rates: Rates = [2.0, 8.0, 2.5, 0.2];

  const known = pricing.lookup(m) ?? claudeRates(m);
  if (known) {
    rates = known;
  } else if (m.includes("gpt-6") || m.includes("gpt-5") || m.includes("o3") || m.includes("o4")) {
    rates = [2.5, 10.0, 2.5, 0.25];
  } else if (m.includes("gemini") && m.includes("pro")) {
    rates = [1.25, 10.0, 1.25, 0.31];
  } else if (m.includes("flash")) {
    rates = [0.15, 0.6, 0.15, 0.0375];
  } else if (
    m.includes("minimax") ||
    m.includes("glm") ||
    m.includes("kimi") ||
    m.includes("mimo") ||
    m.includes("qwen")
  ) {
    rates = [0.5, 2.0, 0.5, 0.1];
  }

  const [inRate, outRate, cwRate, crRate] = rates;
  return (
    (params.inputTokens / M) * inRate +
    (params.outputTokens / M) * outRate +
    (params.cacheCreationTokens / M) * cwRate +
    (params.cacheReadTokens / M) * crRate
  );
}

async function runCcusageJson(subcommandArgs: string[], timeoutMs = 25000): Promise<any | null> {
  const { cmd } = resolveCcusageBinary();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // stderr is never read, so piping it could fill the buffer and stall the child.
    const proc = Bun.spawn([...cmd, ...subcommandArgs, "--json", "-O"], {
      stdout: "pipe",
      stderr: "ignore",
    });

    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);

    const text = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0 || !text.trim()) {
      return null;
    }
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface RawHarnessData {
  dailyRaw: any;
  sessionRaw: any;
  syncStatus: "ready" | "syncing" | "idle" | "error";
  lastSyncMs?: number;
}

const inMemoryHarnessStore = new Map<HarnessId, RawHarnessData>();
let antigravitySyncInFlight = false;
let cachedDashboardPayload: DashboardPayload | null = null;
let refreshInFlight: Promise<DashboardPayload> | null = null;

function normalizeModelBreakdowns(row: any, harness: HarnessId): ModelMetric[] {
  const list: ModelMetric[] = [];

  if (Array.isArray(row.modelBreakdowns) && row.modelBreakdowns.length > 0) {
    for (const mb of row.modelBreakdowns) {
      const modelName = String(mb.modelName || "unknown");
      const inputTokens = Number(mb.inputTokens || 0);
      const outputTokens = Number(mb.outputTokens || 0);
      const cacheCreationTokens = Number(mb.cacheCreationTokens || 0);
      const cacheReadTokens = Number(mb.cacheReadTokens || 0);
      const reasoningOutputTokens = Number(mb.reasoningOutputTokens || 0);
      const totalTokens =
        Number(mb.totalTokens || 0) ||
        inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
      const rawCost = Number(mb.cost ?? mb.costUSD ?? 0);
      const missingPricing = Boolean(mb.missingPricing) || (rawCost === 0 && totalTokens > 0);
      const verifiedCost = Math.max(0, rawCost);
      const estimatedCost =
        verifiedCost > 0
          ? verifiedCost
          : estimateFrontierCost({
              modelName,
              inputTokens,
              outputTokens,
              cacheCreationTokens,
              cacheReadTokens,
              reasoningOutputTokens,
            });

      list.push({
        modelName,
        harness,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        reasoningOutputTokens,
        totalTokens,
        verifiedCost,
        estimatedCost,
        missingPricing,
      });
    }
  } else if (row.models && typeof row.models === "object" && !Array.isArray(row.models)) {
    // Codex format: models is a Record<modelName, metrics>
    const entries = Object.entries(row.models as Record<string, any>);
    const rowCost = Math.max(0, Number(row.costUSD ?? row.totalCost ?? 0));
    const rowTotalTokens = Number(row.totalTokens || 0);

    for (const [modelName, mb] of entries) {
      const inputTokens = Number(mb.inputTokens || 0);
      const outputTokens = Number(mb.outputTokens || 0);
      const cacheCreationTokens = Number(mb.cacheCreationTokens || 0);
      const cacheReadTokens = Number(mb.cacheReadTokens || 0);
      const reasoningOutputTokens = Number(mb.reasoningOutputTokens || 0);
      const totalTokens =
        Number(mb.totalTokens || 0) ||
        inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
      const missingPricing = Boolean(mb.missingPricing);

      let verifiedCost = Number(mb.cost ?? mb.costUSD ?? 0);
      if (verifiedCost === 0 && !missingPricing && rowCost > 0 && rowTotalTokens > 0) {
        verifiedCost = rowCost * (totalTokens / rowTotalTokens);
      }

      const estimatedCost =
        verifiedCost > 0
          ? verifiedCost
          : estimateFrontierCost({
              modelName,
              inputTokens,
              outputTokens,
              cacheCreationTokens,
              cacheReadTokens,
              reasoningOutputTokens,
            });

      list.push({
        modelName,
        harness,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        reasoningOutputTokens,
        totalTokens,
        verifiedCost,
        estimatedCost,
        missingPricing: missingPricing || (verifiedCost === 0 && totalTokens > 0),
      });
    }
  }

  return list;
}

function getIsoWeekKey(dateStr: string): { key: string; label: string } {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return { key: dateStr, label: dateStr };
  }
  return isoWeek(parts[0]!, parts[1]!, parts[2]!);
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function loadAntigravityFromDiskCache(): RawHarnessData | null {
  try {
    if (existsSync(ANTIGRAVITY_DAILY_CACHE)) {
      const dailyText = readFileSync(ANTIGRAVITY_DAILY_CACHE, "utf8").trim();
      const sessionText = existsSync(ANTIGRAVITY_SESSION_CACHE)
        ? readFileSync(ANTIGRAVITY_SESSION_CACHE, "utf8").trim()
        : "";
      if (dailyText) {
        const dailyRaw = JSON.parse(dailyText);
        const sessionRaw = sessionText ? JSON.parse(sessionText) : { sessions: [] };
        return {
          dailyRaw,
          sessionRaw,
          syncStatus: "ready",
        };
      }
    }
  } catch {
    // ignore corrupt cache
  }
  return null;
}

async function syncAntigravityInBackground(): Promise<void> {
  if (antigravitySyncInFlight) return;
  antigravitySyncInFlight = true;

  const existing = inMemoryHarnessStore.get("antigravity");
  if (!existing) {
    const fromDisk = loadAntigravityFromDiskCache();
    if (fromDisk) {
      inMemoryHarnessStore.set("antigravity", { ...fromDisk, syncStatus: "syncing" });
    } else {
      inMemoryHarnessStore.set("antigravity", {
        dailyRaw: { daily: [] },
        sessionRaw: { sessions: [] },
        syncStatus: "syncing",
      });
    }
  } else {
    existing.syncStatus = "syncing";
  }

  const t0 = performance.now();
  try {
    const [dailyRaw, sessionRaw] = await Promise.all([
      runCcusageJson(["antigravity", "daily"], 180_000),
      runCcusageJson(["antigravity", "session"], 180_000),
    ]);
    const elapsed = Math.round(performance.now() - t0);

    if (dailyRaw) {
      const previousSessions = inMemoryHarnessStore.get("antigravity")?.sessionRaw;
      inMemoryHarnessStore.set("antigravity", {
        dailyRaw,
        sessionRaw: sessionRaw ?? previousSessions ?? { sessions: [] },
        syncStatus: "ready",
        lastSyncMs: elapsed,
      });
      try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(ANTIGRAVITY_DAILY_CACHE, JSON.stringify(dailyRaw, null, 2), "utf8");
        if (sessionRaw) writeFileSync(ANTIGRAVITY_SESSION_CACHE, JSON.stringify(sessionRaw, null, 2), "utf8");
      } catch {
        // Fresh in-memory results remain usable if disk caching is unavailable.
      }
      // A fast refresh may finish before the deep scan. Rebuild after it settles so
      // the finished scan is always reflected in the dashboard and on disk.
      if (refreshInFlight) {
        try { await refreshInFlight; } catch { /* Keep the deep-scan result. */ }
      }
      cachedDashboardPayload = buildDashboardPayloadFromStore();
      try {
        writeFileSync(DASHBOARD_CACHE_FILE, JSON.stringify(cachedDashboardPayload), "utf8");
      } catch {
        // Fresh in-memory results remain usable if disk caching is unavailable.
      }
    } else {
      const prev = inMemoryHarnessStore.get("antigravity");
      if (prev) prev.syncStatus = "error";
    }
  } catch {
    const prev = inMemoryHarnessStore.get("antigravity");
    if (prev) prev.syncStatus = "error";
  } finally {
    antigravitySyncInFlight = false;
  }
}

async function runHarnessRefresh(options?: { forceDeepScan?: boolean }): Promise<DashboardPayload> {
  mkdirSync(CACHE_DIR, { recursive: true });

  // Starts now so the price download overlaps the ccusage runs below; estimates are
  // built after they finish, and ensure() never throws or blocks for long.
  const pricesReady = pricing.ensure();

  // Seed antigravity from disk cache immediately if available
  const diskAg = loadAntigravityFromDiskCache();
  if (diskAg && !inMemoryHarnessStore.has("antigravity")) {
    inMemoryHarnessStore.set("antigravity", diskAg);
  }

  // Trigger background sync for Antigravity if we don't have disk cache or if forceDeepScan is true
  if (!diskAg || options?.forceDeepScan) {
    void syncAntigravityInBackground();
  }

  // Run all 17 fast harnesses in parallel
  const fastHarnesses = HARNESS_DEFINITIONS.filter((h) => !h.slowScan);
  await Promise.all(
    fastHarnesses.map(async (h) => {
      const t0 = performance.now();
      const [dailyRaw, sessionRaw] = await Promise.all([
        runCcusageJson([h.id, "daily"], 15_000),
        runCcusageJson([h.id, "session"], 15_000),
      ]);
      const elapsed = Math.round(performance.now() - t0);
      // null means ccusage failed or timed out (a harness with no data still returns
      // empty JSON), so keep the last good data rather than wiping it to zero.
      const prev = inMemoryHarnessStore.get(h.id);
      inMemoryHarnessStore.set(h.id, {
        dailyRaw: dailyRaw ?? prev?.dailyRaw ?? { daily: [] },
        sessionRaw: sessionRaw ?? prev?.sessionRaw ?? { sessions: [] },
        syncStatus: dailyRaw && sessionRaw ? "ready" : "error",
        lastSyncMs: elapsed,
      });
    })
  );

  // Also check if antigravity cache arrived on disk while fast harnesses ran
  if (!inMemoryHarnessStore.get("antigravity")?.dailyRaw?.daily?.length) {
    const freshDiskAg = loadAntigravityFromDiskCache();
    if (freshDiskAg) {
      inMemoryHarnessStore.set("antigravity", freshDiskAg);
    }
  }

  await pricesReady;
  cachedDashboardPayload = buildDashboardPayloadFromStore();
  try {
    writeFileSync(DASHBOARD_CACHE_FILE, JSON.stringify(cachedDashboardPayload), "utf8");
  } catch {
    // ignore
  }
  return cachedDashboardPayload;
}

export function refreshAllHarnesses(options?: { forceDeepScan?: boolean }): Promise<DashboardPayload> {
  if (refreshInFlight) {
    if (options?.forceDeepScan) void syncAntigravityInBackground();
    return refreshInFlight;
  }
  const run = runHarnessRefresh(options);
  refreshInFlight = run;
  void run.then(
    () => { if (refreshInFlight === run) refreshInFlight = null; },
    () => { if (refreshInFlight === run) refreshInFlight = null; },
  );
  return run;
}

export async function getDashboardData(options?: {
  refresh?: boolean;
  forceDeepScan?: boolean;
}): Promise<DashboardPayload> {
  if (!options?.refresh && cachedDashboardPayload) {
    // Check if antigravity disk cache newly appeared
    const agSummary = cachedDashboardPayload.harnesses.find((h) => h.meta.id === "antigravity");
    if (agSummary && agSummary.totalTokens === 0 && existsSync(ANTIGRAVITY_DAILY_CACHE)) {
      const diskAg = loadAntigravityFromDiskCache();
      if (diskAg && diskAg.dailyRaw?.daily?.length > 0) {
        inMemoryHarnessStore.set("antigravity", diskAg);
        cachedDashboardPayload = buildDashboardPayloadFromStore();
      }
    }
    return cachedDashboardPayload;
  }

  if (!options?.refresh && existsSync(DASHBOARD_CACHE_FILE) && inMemoryHarnessStore.size === 0) {
    try {
      const cached = JSON.parse(readFileSync(DASHBOARD_CACHE_FILE, "utf8")) as DashboardPayload;
      cachedDashboardPayload = cached;
      // Refresh fast harnesses in background
      void refreshAllHarnesses({ forceDeepScan: false });
      return cached;
    } catch {
      // fall through
    }
  }

  return refreshAllHarnesses({ forceDeepScan: options?.forceDeepScan });
}

function addMetricToPeriod(
  map: Map<string, TimePeriodRow>,
  periodKey: string,
  periodLabel: string,
  harnessId: HarnessId,
  rowMetrics: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    verifiedCost: number;
    estimatedCost: number;
    models: ModelMetric[];
  }
): void {
  let periodRow = map.get(periodKey);
  if (!periodRow) {
    periodRow = {
      period: periodKey,
      label: periodLabel,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      verifiedCost: 0,
      estimatedCost: 0,
      byHarness: {},
      modelsUsed: [],
    };
    map.set(periodKey, periodRow);
  }

  periodRow.inputTokens += rowMetrics.inputTokens;
  periodRow.outputTokens += rowMetrics.outputTokens;
  periodRow.cacheCreationTokens += rowMetrics.cacheCreationTokens;
  periodRow.cacheReadTokens += rowMetrics.cacheReadTokens;
  periodRow.reasoningOutputTokens += rowMetrics.reasoningOutputTokens;
  periodRow.totalTokens += rowMetrics.totalTokens;
  periodRow.verifiedCost += rowMetrics.verifiedCost;
  periodRow.estimatedCost += rowMetrics.estimatedCost;

  let hb: PeriodHarnessBreakdown | undefined = periodRow.byHarness[harnessId];
  if (!hb) {
    hb = {
      harness: harnessId,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      verifiedCost: 0,
      estimatedCost: 0,
      models: [],
    };
    periodRow.byHarness[harnessId] = hb;
  }

  hb.inputTokens += rowMetrics.inputTokens;
  hb.outputTokens += rowMetrics.outputTokens;
  hb.cacheCreationTokens += rowMetrics.cacheCreationTokens;
  hb.cacheReadTokens += rowMetrics.cacheReadTokens;
  hb.reasoningOutputTokens += rowMetrics.reasoningOutputTokens;
  hb.totalTokens += rowMetrics.totalTokens;
  hb.verifiedCost += rowMetrics.verifiedCost;
  hb.estimatedCost += rowMetrics.estimatedCost;

  for (const m of rowMetrics.models) {
    if (!periodRow.modelsUsed.includes(m.modelName)) {
      periodRow.modelsUsed.push(m.modelName);
    }
    const existingModel = hb.models.find((x) => x.modelName === m.modelName);
    if (existingModel) {
      existingModel.inputTokens += m.inputTokens;
      existingModel.outputTokens += m.outputTokens;
      existingModel.cacheCreationTokens += m.cacheCreationTokens;
      existingModel.cacheReadTokens += m.cacheReadTokens;
      existingModel.reasoningOutputTokens += m.reasoningOutputTokens;
      existingModel.totalTokens += m.totalTokens;
      existingModel.verifiedCost += m.verifiedCost;
      existingModel.estimatedCost += m.estimatedCost;
    } else {
      hb.models.push({ ...m });
    }
  }
}

function buildDashboardPayloadFromStore(): DashboardPayload {
  const { version } = resolveCcusageBinary();

  const dailyMap = new Map<string, TimePeriodRow>();
  const weeklyMap = new Map<string, TimePeriodRow>();
  const monthlyMap = new Map<string, TimePeriodRow>();
  const yearlyMap = new Map<string, TimePeriodRow>();
  const globalModelMap = new Map<string, ModelMetric>();
  const allSessions: SessionEntry[] = [];
  const harnessSummaries: HarnessSummary[] = [];
  const syncingHarnesses: HarnessId[] = [];

  for (const def of HARNESS_DEFINITIONS) {
    const raw = inMemoryHarnessStore.get(def.id);
    const dailyRows: any[] = Array.isArray(raw?.dailyRaw?.daily) ? raw.dailyRaw.daily : [];
    const sessionRows: any[] = Array.isArray(raw?.sessionRaw?.sessions)
      ? raw.sessionRaw.sessions
      : [];
    const unpricedModels: string[] = Array.isArray(raw?.dailyRaw?.totals?.unpricedModels)
      ? raw.dailyRaw.totals.unpricedModels
      : [];

    const installedOnDisk = def.detectPaths.some((p) => existsSync(p));
    const hasUsage = dailyRows.length > 0 || sessionRows.length > 0;
    const installed = installedOnDisk || hasUsage;
    const syncStatus = raw?.syncStatus ?? (def.slowScan ? "syncing" : "idle");

    if (syncStatus === "syncing") {
      syncingHarnesses.push(def.id);
    }

    const harnessModelMap = new Map<string, ModelMetric>();
    let hInput = 0;
    let hOutput = 0;
    let hCacheCreate = 0;
    let hCacheRead = 0;
    let hReasoning = 0;
    let hTotal = 0;
    let hVerifiedCost = 0;
    let hEstimatedCost = 0;
    let lastActiveDate: string | null = null;

    for (const dRow of dailyRows) {
      const dateStr = String(dRow.date || "");
      if (!dateStr) continue;
      if (!lastActiveDate || dateStr > lastActiveDate) {
        lastActiveDate = dateStr;
      }

      const inputTokens = Number(dRow.inputTokens || 0);
      const outputTokens = Number(dRow.outputTokens || 0);
      const cacheCreationTokens = Number(dRow.cacheCreationTokens || 0);
      const cacheReadTokens = Number(dRow.cacheReadTokens || 0);
      const reasoningOutputTokens = Number(dRow.reasoningOutputTokens || 0);
      const totalTokens =
        Number(dRow.totalTokens || 0) ||
        inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;

      const models = normalizeModelBreakdowns(dRow, def.id);
      const rowRawCost = Math.max(0, Number(dRow.totalCost ?? dRow.costUSD ?? 0));
      const modelsVerifiedSum = models.reduce((acc, m) => acc + m.verifiedCost, 0);
      const modelsEstimatedSum = models.reduce((acc, m) => acc + m.estimatedCost, 0);

      const verifiedCost = Math.max(rowRawCost, modelsVerifiedSum);
      const estimatedCost =
        modelsEstimatedSum > 0
          ? Math.max(verifiedCost, modelsEstimatedSum)
          : verifiedCost > 0
            ? verifiedCost
            : estimateFrontierCost({
                modelName: def.id,
                inputTokens,
                outputTokens,
                cacheCreationTokens,
                cacheReadTokens,
                reasoningOutputTokens,
              });

      hInput += inputTokens;
      hOutput += outputTokens;
      hCacheCreate += cacheCreationTokens;
      hCacheRead += cacheReadTokens;
      hReasoning += reasoningOutputTokens;
      hTotal += totalTokens;
      hVerifiedCost += verifiedCost;
      hEstimatedCost += estimatedCost;

      for (const m of models) {
        const prevH = harnessModelMap.get(m.modelName);
        if (prevH) {
          prevH.inputTokens += m.inputTokens;
          prevH.outputTokens += m.outputTokens;
          prevH.cacheCreationTokens += m.cacheCreationTokens;
          prevH.cacheReadTokens += m.cacheReadTokens;
          prevH.reasoningOutputTokens += m.reasoningOutputTokens;
          prevH.totalTokens += m.totalTokens;
          prevH.verifiedCost += m.verifiedCost;
          prevH.estimatedCost += m.estimatedCost;
          prevH.missingPricing = prevH.missingPricing || m.missingPricing;
        } else {
          harnessModelMap.set(m.modelName, { ...m });
        }

        const gKey = `${def.id}::${m.modelName}`;
        const prevG = globalModelMap.get(gKey);
        if (prevG) {
          prevG.inputTokens += m.inputTokens;
          prevG.outputTokens += m.outputTokens;
          prevG.cacheCreationTokens += m.cacheCreationTokens;
          prevG.cacheReadTokens += m.cacheReadTokens;
          prevG.reasoningOutputTokens += m.reasoningOutputTokens;
          prevG.totalTokens += m.totalTokens;
          prevG.verifiedCost += m.verifiedCost;
          prevG.estimatedCost += m.estimatedCost;
          prevG.missingPricing = prevG.missingPricing || m.missingPricing;
        } else {
          globalModelMap.set(gKey, { ...m });
        }
      }

      const periodMetrics = {
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        reasoningOutputTokens,
        totalTokens,
        verifiedCost,
        estimatedCost,
        models,
      };

      // 1. Daily
      addMetricToPeriod(dailyMap, dateStr, dateStr, def.id, periodMetrics);

      // 2. Weekly
      const weekInfo = getIsoWeekKey(dateStr);
      addMetricToPeriod(weeklyMap, weekInfo.key, weekInfo.label, def.id, periodMetrics);

      // 3. Monthly
      const monthKey = dateStr.slice(0, 7);
      addMetricToPeriod(
        monthlyMap,
        monthKey,
        formatMonthLabel(monthKey),
        def.id,
        periodMetrics
      );

      // 4. Yearly
      const yearKey = dateStr.slice(0, 4);
      addMetricToPeriod(yearlyMap, yearKey, yearKey, def.id, periodMetrics);
    }

    // Parse sessions
    for (const [sIndex, sRow] of sessionRows.entries()) {
      const inputTokens = Number(sRow.inputTokens || 0);
      const outputTokens = Number(sRow.outputTokens || 0);
      const cacheCreationTokens = Number(sRow.cacheCreationTokens || 0);
      const cacheReadTokens = Number(sRow.cacheReadTokens || 0);
      const reasoningOutputTokens = Number(sRow.reasoningOutputTokens || 0);
      const totalTokens =
        Number(sRow.totalTokens || 0) ||
        inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;

      const modelBreakdowns = normalizeModelBreakdowns(sRow, def.id);
      const rawCost = Math.max(0, Number(sRow.totalCost ?? sRow.costUSD ?? 0));
      const modelsEst = modelBreakdowns.reduce((acc, m) => acc + m.estimatedCost, 0);
      const verifiedCost = rawCost;
      const estimatedCost = Math.max(verifiedCost, modelsEst);

      const sessionId = sRow.sessionId ? String(sRow.sessionId) : "";
      const opencodeUpdated = def.id === "opencode" && sessionId ? opencodeSessionUpdated(sessionId) : null;
      const lastActivity = sRow.lastActivity
        ? String(sRow.lastActivity)
        : opencodeUpdated
          ? new Date(opencodeUpdated).toISOString()
          : undefined;
      const firstActivity = sRow.firstActivity ? String(sRow.firstActivity) : undefined;
      // Timestamps are UTC; daily rows are local days, so bucket sessions the same way.
      let date = lastActivity ? localDateKey(new Date(lastActivity)) : "";
      // Codex groups rollouts under YYYY/MM/DD folders.
      if (!date && /^\d{4}\/\d{2}\/\d{2}$/.test(String(sRow.directory ?? ""))) {
        date = String(sRow.directory).replace(/\//g, "-");
      }

      const rawProject = String(
        sRow.projectPath || sRow.directory || sRow.sessionFile || sRow.sessionId || def.name
      );
      const project = sessionId
        ? resolveSessionProject(def.id, sessionId, String(sRow.projectPath ?? ""))
        : null;
      const modelsUsed = modelBreakdowns.length
        ? modelBreakdowns.map((m) => m.modelName)
        : Array.isArray(sRow.modelsUsed)
          ? sRow.modelsUsed.map(String)
          : [];

      allSessions.push({
        id: `${def.id}-${sessionId || `${date}-${sIndex}`}`,
        harness: def.id,
        projectPath: rawProject,
        cwd: project?.cwd,
        projectRoot: project?.root,
        projectName: project?.name,
        firstActivity,
        lastActivity,
        date: date || "Unknown",
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        reasoningOutputTokens,
        totalTokens,
        verifiedCost,
        estimatedCost,
        modelsUsed,
        modelBreakdowns,
      });
    }

    const harnessModels = Array.from(harnessModelMap.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens
    );
    const topModel = harnessModels[0]?.modelName ?? null;
    const totalPromptSide = hInput + hCacheRead + hCacheCreate;
    const cacheHitRate =
      totalPromptSide > 0 ? Math.round((hCacheRead / totalPromptSide) * 1000) / 10 : 0;

    const meta: HarnessMetadata = {
      id: def.id,
      name: def.name,
      vendor: def.vendor,
      color: def.color,
      accentBg: def.accentBg,
      description: def.description,
      configPathHint: def.configPathHint,
      installed,
      hasUsage,
      syncStatus,
      lastSyncMs: raw?.lastSyncMs,
    };

    harnessSummaries.push({
      meta,
      inputTokens: hInput,
      outputTokens: hOutput,
      cacheCreationTokens: hCacheCreate,
      cacheReadTokens: hCacheRead,
      reasoningOutputTokens: hReasoning,
      totalTokens: hTotal,
      verifiedCost: hVerifiedCost,
      estimatedCost: hEstimatedCost,
      activeDays: dailyRows.length,
      sessionCount: sessionRows.length || dailyRows.length,
      lastActiveDate,
      topModel,
      cacheHitRate,
      models: harnessModels,
      unpricedModels,
    });
  }

  // Sort harnesses: active with most tokens first, then installed, then alphabetical
  harnessSummaries.sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    if (a.meta.installed !== b.meta.installed) return a.meta.installed ? -1 : 1;
    return a.meta.name.localeCompare(b.meta.name);
  });

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.period.localeCompare(b.period));
  const weekly = Array.from(weeklyMap.values()).sort((a, b) => a.period.localeCompare(b.period));
  const monthly = Array.from(monthlyMap.values()).sort((a, b) =>
    a.period.localeCompare(b.period)
  );
  const yearly = Array.from(yearlyMap.values()).sort((a, b) => a.period.localeCompare(b.period));
  const models = Array.from(globalModelMap.values()).sort(
    (a, b) => b.totalTokens - a.totalTokens
  );

  allSessions.sort((a, b) => {
    const da = a.lastActivity || a.date || "";
    const db = b.lastActivity || b.date || "";
    if (db !== da) return db.localeCompare(da);
    return b.totalTokens - a.totalTokens;
  });

  const totalInput = harnessSummaries.reduce((acc, h) => acc + h.inputTokens, 0);
  const totalOutput = harnessSummaries.reduce((acc, h) => acc + h.outputTokens, 0);
  const totalCacheCreate = harnessSummaries.reduce((acc, h) => acc + h.cacheCreationTokens, 0);
  const totalCacheRead = harnessSummaries.reduce((acc, h) => acc + h.cacheReadTokens, 0);
  const totalReasoning = harnessSummaries.reduce((acc, h) => acc + h.reasoningOutputTokens, 0);
  const grandTotalTokens = harnessSummaries.reduce((acc, h) => acc + h.totalTokens, 0);
  const grandVerifiedCost = harnessSummaries.reduce((acc, h) => acc + h.verifiedCost, 0);
  const grandEstimatedCost = harnessSummaries.reduce((acc, h) => acc + h.estimatedCost, 0);

  const promptTotal = totalInput + totalCacheRead + totalCacheCreate;
  const globalCacheHitRate =
    promptTotal > 0 ? Math.round((totalCacheRead / promptTotal) * 1000) / 10 : 0;

  saveSessionProjects();

  return {
    generatedAt: new Date().toISOString(),
    ccusageVersion: version,
    syncingHarnesses,
    totals: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheCreationTokens: totalCacheCreate,
      cacheReadTokens: totalCacheRead,
      reasoningOutputTokens: totalReasoning,
      totalTokens: grandTotalTokens,
      verifiedCost: grandVerifiedCost,
      estimatedCost: grandEstimatedCost,
      activeHarnesses: harnessSummaries.filter((h) => h.meta.hasUsage).length,
      installedHarnesses: harnessSummaries.filter((h) => h.meta.installed).length,
      totalHarnesses: HARNESS_DEFINITIONS.length,
      activeDays: daily.length,
      totalSessions: allSessions.length,
      cacheHitRate: globalCacheHitRate,
    },
    harnesses: harnessSummaries,
    daily,
    weekly,
    monthly,
    yearly,
    models,
    // Date-range filters and the Projects view need the full history, not just recent sessions.
    sessions: allSessions.slice(0, 5000),
  };
}
