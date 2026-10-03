import { join, resolve } from "node:path";
import type { DashboardPayload, HarnessId, HarnessSummary, ModelMetric, PeriodHarnessBreakdown, SessionEntry, TimePeriodRow } from "../src/types.ts";

// A self-contained sample dashboard for documentation captures. It never reads local usage files.
const clientDir = resolve(import.meta.dir, "../src/client");
const port = Number(process.env.DOCS_DEMO_PORT || 4280);
const tools = [
  { id: "codex", name: "Codex CLI", vendor: "OpenAI", color: "#d65a32", model: "gpt-5-codex", weight: 1.2 },
  { id: "claude", name: "Claude Code", vendor: "Anthropic", color: "#db9600", model: "claude-opus-4-1", weight: 1 },
  { id: "antigravity", name: "Antigravity", vendor: "Google", color: "#3c8adb", model: "gemini-2.5-pro", weight: 0.74 },
  { id: "pi", name: "pi-agent", vendor: "Pi", color: "#21a67a", model: "gpt-5", weight: 0.27 },
] as const;
const projects = ["Atlas", "Meridian", "Orchard", "Northstar"];
const metricFields = ["inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "reasoningOutputTokens", "totalTokens", "verifiedCost", "estimatedCost"] as const;
type MetricField = typeof metricFields[number];
type Metrics = Pick<ModelMetric, MetricField>;

function emptyMetrics(): Metrics {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, verifiedCost: 0, estimatedCost: 0 };
}

function addMetrics(target: Metrics, source: Metrics) {
  for (const field of metricFields) target[field] += source[field];
}

function sampleMetrics(scale: number): Metrics {
  const inputTokens = Math.round(114_000 * scale);
  const outputTokens = Math.round(21_000 * scale);
  const cacheCreationTokens = Math.round(8_000 * scale);
  const cacheReadTokens = Math.round(465_000 * scale);
  return {
    inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
    reasoningOutputTokens: Math.round(5_000 * scale),
    totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
    verifiedCost: Number((0.11 * scale).toFixed(2)),
    estimatedCost: Number((1.34 * scale).toFixed(2)),
  };
}

function localDay(offset: number): string {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() - offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function fixture(): DashboardPayload {
  const daily: TimePeriodRow[] = [];
  const sums = new Map<HarnessId, Metrics>(tools.map((tool) => [tool.id, emptyMetrics()]));
  const active = new Map<HarnessId, number>(tools.map((tool) => [tool.id, 0]));
  const sessions: SessionEntry[] = [];

  for (let offset = 179; offset >= 0; offset--) {
    const period = localDay(offset);
    const byHarness: Record<string, PeriodHarnessBreakdown> = {};
    const rowTotal = emptyMetrics();
    for (const [index, tool] of tools.entries()) {
      if ((offset * 7 + index * 11) % 9 > 5) continue;
      const scale = tool.weight * (0.65 + ((offset * 13 + index * 5) % 14) / 10);
      const metrics = sampleMetrics(scale);
      addMetrics(rowTotal, metrics);
      addMetrics(sums.get(tool.id)!, metrics);
      active.set(tool.id, active.get(tool.id)! + 1);
      const model: ModelMetric = { ...metrics, modelName: tool.model, harness: tool.id, missingPricing: false };
      byHarness[tool.id] = { ...metrics, harness: tool.id, models: [model] };

      if (offset <= 25 && (offset + index) % 3 !== 2) {
        const projectName = projects[(offset + index) % projects.length]!;
        sessions.push({
          id: `sample-${period}-${tool.id}`,
          harness: tool.id,
          projectPath: `/sample-projects/${projectName.toLowerCase()}`,
          cwd: `/sample-projects/${projectName.toLowerCase()}`,
          projectRoot: `/sample-projects/${projectName.toLowerCase()}`,
          projectName,
          date: period,
          firstActivity: `${period}T09:15:00.000Z`,
          lastActivity: `${period}T10:42:00.000Z`,
          ...metrics,
          modelsUsed: [tool.model],
          modelBreakdowns: [model],
        });
      }
    }
    daily.push({ ...rowTotal, period, label: period, byHarness, modelsUsed: tools.filter((tool) => byHarness[tool.id]).map((tool) => tool.model) });
  }

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
    generatedAt: new Date().toISOString(), ccusageVersion: "sample", syncingHarnesses: [],
    totals: {
      ...total,
      activeHarnesses: tools.length, installedHarnesses: tools.length, totalHarnesses: tools.length,
      activeDays: daily.filter((day) => day.totalTokens > 0).length,
      totalSessions: sessions.length,
      cacheHitRate: 100 * total.cacheReadTokens / (total.inputTokens + total.cacheReadTokens),
    },
    harnesses, daily, weekly: [], monthly: [], yearly: [], models, sessions,
  };
}

const bundle = Bun.build({
  entrypoints: [join(clientDir, "main.tsx")], target: "browser", format: "esm", minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
}).then(async (result) => {
  if (!result.success || !result.outputs[0]) throw new Error("Could not build the dashboard client");
  return result.outputs[0].text();
});
const sample = fixture();

Bun.serve({
  port, hostname: "127.0.0.1",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/" || path === "/index.html") return new Response(Bun.file(join(clientDir, "index.html")), { headers: { "Content-Type": "text/html" } });
    if (path === "/styles.css") return new Response(Bun.file(join(clientDir, "styles.css")), { headers: { "Content-Type": "text/css" } });
    if (path === "/logo.svg") return new Response(Bun.file(join(clientDir, "logo.svg")), { headers: { "Content-Type": "image/svg+xml" } });
    if (path === "/app.js") return new Response(await bundle, { headers: { "Content-Type": "application/javascript" } });
    if (path === "/api/usage") return Response.json(sample);
    if (path === "/api/startup" && request.method === "GET") return Response.json({ enabled: false, openBrowserOnBoot: false, port, platform: "windows", entry: null, entryPath: "Sample dashboard", disabledBySystem: false, launcherPath: "Sample dashboard" });
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Documentation sample dashboard: http://localhost:${port}`);
