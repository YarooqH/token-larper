import type {
  ActivityRow, DashboardPayload, HarnessId, HarnessLimitCard, HarnessSummary, LimitsPayload, LiveEvent, ModelMetric,
  ModelPrice, PeriodHarnessBreakdown, SessionEntry, SpeedTotals, ThroughputPayload, ThroughputRow, TimePeriodRow,
} from "../src/types.ts";
import { activityByDay, mergeIntervals, rowsFromSamples, sessionsFromSamples, type Interval, type Sample } from "../src/throughput/stats.ts";

// Made-up usage for the live demo and the documentation captures. Nothing here reads local
// files, so it runs in the browser as well as in Bun. Every number comes from a seeded
// generator, so a given day always looks the same.

export const tools = [
  { id: "claude", name: "Claude Code", vendor: "Anthropic", color: "#db9600", model: "claude-opus-5-5", weight: 1.1, tokPerSec: 72 },
  { id: "codex", name: "Codex CLI", vendor: "OpenAI", color: "#d65a32", model: "gpt-5-codex", weight: 1, tokPerSec: 95 },
  { id: "antigravity", name: "Antigravity", vendor: "Google", color: "#3c8adb", model: "gemini-2.5-pro", weight: 0.62, tokPerSec: 128 },
  { id: "copilot", name: "Copilot CLI", vendor: "GitHub", color: "#8957e5", model: "gpt-5", weight: 0.34, tokPerSec: 64 },
  { id: "opencode", name: "OpenCode", vendor: "SST", color: "#21a67a", model: "kimi-k2", weight: 0.22, tokPerSec: 110 },
] as const satisfies readonly { id: HarnessId; [key: string]: unknown }[];

type Tool = typeof tools[number];

const projects = ["Atlas", "Meridian", "Orchard", "Northstar", "Lantern"];
const DAYS = 180;
const SESSION_DAYS = 30;

// Per million tokens: input, output, cache write, cache read.
const prices: Record<string, ModelPrice["rates"]> = {
  "claude-opus-5-5": [5, 25, 6.25, 0.5],
  "gpt-5-codex": [1.25, 10, 0, 0.125],
  "gemini-2.5-pro": [1.25, 10, 0, 0.31],
  "gpt-5": [1.25, 10, 0, 0.125],
  "kimi-k2": [0.6, 2.5, 0, 0.15],
};

const metricFields = ["inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "reasoningOutputTokens", "totalTokens", "verifiedCost", "estimatedCost"] as const;
type Metrics = Pick<ModelMetric, typeof metricFields[number]>;

/** Mulberry32: small, fast, and the same everywhere. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daySeed(day: string, salt: number): number {
  let h = salt * 2654435761;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function emptyMetrics(): Metrics {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, verifiedCost: 0, estimatedCost: 0 };
}

function addMetrics(target: Metrics, source: Metrics) {
  for (const field of metricFields) target[field] += source[field];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function costOf(model: string, m: Pick<Metrics, "inputTokens" | "outputTokens" | "cacheCreationTokens" | "cacheReadTokens">): number {
  const [input, output, write, read] = prices[model] ?? [0, 0, 0, 0];
  return (m.inputTokens * input + m.outputTokens * output + m.cacheCreationTokens * write + m.cacheReadTokens * read) / 1e6;
}

function sampleMetrics(tool: Tool, scale: number): Metrics {
  const inputTokens = Math.round(310_000 * scale);
  const outputTokens = Math.round(58_000 * scale);
  const cacheCreationTokens = tool.id === "claude" ? Math.round(140_000 * scale) : 0;
  const cacheReadTokens = Math.round(4_200_000 * scale);
  const cost = round2(costOf(tool.model, { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens }));
  return {
    inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
    reasoningOutputTokens: tool.id === "codex" ? Math.round(12_000 * scale) : 0,
    totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
    verifiedCost: cost,
    estimatedCost: cost,
  };
}

function localDay(offset: number, now = new Date()): string {
  const day = new Date(now);
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() - offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** How busy a tool is on a day: 0 means unused. Weekends are quieter, and usage grows over the months. */
function dayScale(tool: Tool, index: number, offset: number, now: Date): number {
  const date = new Date(now);
  date.setDate(date.getDate() - offset);
  const rand = seeded(daySeed(localDay(offset, now), index + 1));
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  if (rand() < (weekend ? 0.55 : 0.12) + index * 0.06) return 0;
  const growth = 0.55 + 0.45 * (1 - offset / DAYS);
  return tool.weight * growth * (weekend ? 0.45 : 1) * (0.5 + rand());
}

export function dashboardFixture(now = new Date()): DashboardPayload {
  const daily: TimePeriodRow[] = [];
  const sums = new Map<HarnessId, Metrics>(tools.map((tool) => [tool.id, emptyMetrics()]));
  const active = new Map<HarnessId, number>(tools.map((tool) => [tool.id, 0]));
  const sessions: SessionEntry[] = [];

  for (let offset = DAYS - 1; offset >= 0; offset--) {
    const period = localDay(offset, now);
    const byHarness: Record<string, PeriodHarnessBreakdown> = {};
    const rowTotal = emptyMetrics();
    for (const [index, tool] of tools.entries()) {
      const scale = dayScale(tool, index, offset, now);
      if (scale === 0) continue;
      const metrics = sampleMetrics(tool, scale);
      addMetrics(rowTotal, metrics);
      addMetrics(sums.get(tool.id)!, metrics);
      active.set(tool.id, active.get(tool.id)! + 1);
      const model: ModelMetric = { ...metrics, modelName: tool.model, harness: tool.id, missingPricing: false };
      byHarness[tool.id] = { ...metrics, harness: tool.id, models: [model] };

      if (offset < SESSION_DAYS) {
        const projectName = projects[(offset * 3 + index) % projects.length]!;
        const folder = `/home/demo/code/${projectName.toLowerCase()}`;
        sessions.push({
          id: sessionId(tool.id, period),
          harness: tool.id,
          projectPath: folder,
          cwd: folder,
          projectRoot: folder,
          projectName,
          date: period,
          firstActivity: new Date(`${period}T09:20:00`).toISOString(),
          lastActivity: new Date(`${period}T17:05:00`).toISOString(),
          ...metrics,
          modelsUsed: [tool.model],
          modelBreakdowns: [model],
        });
      }
    }
    daily.push({ ...rowTotal, period, label: period, byHarness, modelsUsed: tools.filter((tool) => byHarness[tool.id]).map((tool) => tool.model) });
  }

  // The server lists sessions newest first.
  sessions.reverse();
  const models: ModelMetric[] = tools.map((tool) => ({ ...sums.get(tool.id)!, modelName: tool.model, harness: tool.id, missingPricing: false }));
  const harnesses: HarnessSummary[] = tools.map((tool) => {
    const metrics = sums.get(tool.id)!;
    return {
      meta: { id: tool.id, name: tool.name, vendor: tool.vendor, color: tool.color, accentBg: tool.color, description: "Sample coding tool", configPathHint: "Sample data", installed: true, hasUsage: true, syncStatus: "ready" },
      ...metrics,
      activeDays: active.get(tool.id)!,
      sessionCount: sessions.filter((session) => session.harness === tool.id).length,
      lastActiveDate: daily.findLast((day) => Boolean(day.byHarness[tool.id]))?.period ?? null,
      topModel: tool.model,
      cacheHitRate: 100 * metrics.cacheReadTokens / (metrics.inputTokens + metrics.cacheReadTokens),
      models: [models.find((model) => model.harness === tool.id)!],
      unpricedModels: [],
    };
  });
  const total = emptyMetrics();
  for (const row of daily) addMetrics(total, row);
  return {
    generatedAt: now.toISOString(), ccusageVersion: "sample", syncingHarnesses: [],
    totals: {
      ...total,
      activeHarnesses: tools.length, installedHarnesses: tools.length, totalHarnesses: tools.length,
      activeDays: daily.filter((day) => day.totalTokens > 0).length,
      totalSessions: sessions.length,
      cacheHitRate: 100 * total.cacheReadTokens / (total.inputTokens + total.cacheReadTokens),
    },
    harnesses, daily, weekly: [], monthly: [], yearly: [], models, sessions,
    pricing: {
      status: { fetchedAt: now.toISOString(), models: Object.keys(prices).length, lastDownloadFailed: false, offline: false },
      models: Object.fromEntries(tools.map((tool) => [tool.model, { rates: prices[tool.model]!, source: "openrouter", match: tool.model }])),
    },
  };
}

function sessionId(harness: HarnessId, day: string): string {
  return `${harness}-sample-${day}`;
}

export function throughputFixture(now = new Date()): ThroughputPayload {
  const rows: ThroughputRow[] = [];
  const activity: ActivityRow[] = [];
  const sessions: Record<string, SpeedTotals> = {};
  for (const [index, tool] of tools.entries()) {
    const samples: Sample[] = [];
    for (let offset = DAYS - 1; offset >= 0; offset--) {
      const scale = dayScale(tool, index, offset, now);
      if (scale === 0) continue;
      const day = localDay(offset, now);
      const rand = seeded(daySeed(day, 100 + index));
      const count = Math.round(25 + 50 * scale);
      // Responses come in bursts through the working day.
      let t = new Date(`${day}T09:00:00`).getTime() + rand() * 3_600_000;
      for (let i = 0; i < count; i++) {
        const outputTokens = Math.round(150 + rand() ** 2 * 2_400);
        const rate = tool.tokPerSec * (0.6 + rand() * 0.8);
        const wait = 600 + rand() * 2_400;
        const start = t;
        const end = start + wait + (outputTokens / rate) * 1000;
        samples.push({
          model: tool.model, start, end, outputTokens, firstOutputAt: start + wait,
          session: offset < SESSION_DAYS ? sessionId(tool.id, day) : undefined,
        });
        t = end + (rand() < 0.15 ? 600_000 + rand() * 2_400_000 : 5_000 + rand() * 60_000);
      }
    }
    rows.push(...rowsFromSamples(tool.id, samples));
    const intervals: Interval[] = samples.map((s) => [s.start, s.end]);
    activity.push(...activityByDay(tool.id, mergeIntervals(intervals)));
    Object.assign(sessions, sessionsFromSamples(samples, undefined));
  }
  return { status: "ready", scannedAt: now.toISOString(), timedByTool: ["claude", "codex", "antigravity"], rows, activity, sessions };
}

function quota(id: string, label: string, sublabel: string, usedPercent: number, resetsInMs: number, windowSeconds: number, now: Date) {
  return {
    id, label, sublabel, usedPercent, remainingPercent: 100 - usedPercent,
    resetsAt: new Date(now.getTime() + resetsInMs).toISOString(), windowSeconds,
    status: usedPercent >= 90 ? "critical" as const : usedPercent >= 70 ? "warning" as const : "ok" as const,
  };
}

export function limitsFixture(now = new Date()): LimitsPayload {
  // Percentages drift with the clock so the bars aren't frozen between refreshes.
  const minute = Math.floor(now.getTime() / 60_000);
  const drift = (base: number, spread: number) => Math.min(99, Math.round(base + (minute % spread)));
  const hour = 3_600_000;
  const updatedAt = now.toISOString();
  const items: HarnessLimitCard[] = [
    {
      id: "claude", harness: "claude", name: "Claude Code", vendor: "Anthropic", planName: "Claude Max 5x", source: "live", updatedAt,
      windows: [
        quota("five_hour", "5-hour window", "Rolling 5h block", drift(38, 20), 2.6 * hour, 18_000, now),
        quota("seven_day", "7-day weekly", "All models", drift(61, 6), 3.2 * 24 * hour, 604_800, now),
        quota("seven_day_opus", "7-day Opus", "Opus weekly cap", drift(74, 6), 3.2 * 24 * hour, 604_800, now),
      ],
    },
    {
      id: "codex", harness: "codex", name: "Codex CLI", vendor: "OpenAI", planName: "ChatGPT Plus", source: "live", updatedAt,
      windows: [
        quota("primary", "5-hour window", "Rolling 5h limit", drift(22, 15), 4.1 * hour, 18_000, now),
        quota("secondary", "7-day weekly", "Rolling 7d limit", drift(47, 5), 5.5 * 24 * hour, 604_800, now),
      ],
    },
    {
      id: "antigravity", harness: "antigravity", name: "Antigravity", vendor: "Google", planName: "Google AI Pro", source: "local", sourceLabel: "Local state", updatedAt,
      windows: [
        quota("gemini-pro", "Gemini Pro", "5-hour refresh", drift(12, 10), 3.4 * hour, 18_000, now),
        quota("claude", "Claude and GPT-OSS", "5-hour refresh", drift(55, 10), 3.4 * hour, 18_000, now),
      ],
    },
    {
      id: "copilot", harness: "copilot", name: "Copilot CLI", vendor: "GitHub", planName: "Copilot Pro", source: "live", updatedAt,
      windows: [{
        ...quota("premium", "Premium requests", "Monthly allowance", 64, 9 * 24 * hour, 2_592_000, now),
        usedValueText: "192", limitValueText: "300", remainingValueText: "108 left",
      }],
    },
  ];
  return { generatedAt: updatedAt, items };
}

const liveProjects = ["atlas", "meridian", "orchard"];

/** One response for Live mode. The same `seq` always gives the same response. */
export function liveEvent(seq: number, at: number): LiveEvent {
  const rand = seeded(seq * 7919 + 13);
  const tool = tools[Math.floor(rand() * 3)]!;
  const outputTokens = Math.round(120 + rand() * 1_800);
  const inputTokens = Math.round(800 + rand() * 6_000);
  const cacheReadTokens = Math.round(20_000 + rand() * 90_000);
  const cacheCreationTokens = tool.id === "claude" ? Math.round(rand() * 4_000) : 0;
  const ms = 900 + (outputTokens / tool.tokPerSec) * 1000;
  return {
    id: `demo-${seq}`,
    harness: tool.id,
    model: tool.model,
    start: at - ms,
    at,
    session: `demo-session-${tool.id}`,
    project: liveProjects[seq % liveProjects.length],
    inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
    cost: costOf(tool.model, { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens }),
  };
}
