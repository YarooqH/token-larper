import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { DashboardPayload, ModelMetric, ModelPrice, PricingStatus, TimePeriodRow } from "../../types.ts";
import { DashboardProvider, type Dashboard } from "../context.tsx";

// Fixtures for rendering a dashboard view to static HTML in tests.

const counts = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, reasoningOutputTokens: 0 };

export const model = (over: Partial<ModelMetric> & Pick<ModelMetric, "modelName" | "harness">): ModelMetric => ({
  ...counts,
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
  verifiedCost: 0,
  estimatedCost: 0,
  missingPricing: false,
  ...over,
});

export const MODELS: ModelMetric[] = [
  model({ modelName: "claude-opus-5-5", harness: "claude", totalTokens: 9000, estimatedCost: 85.9, missingPricing: true }),
  model({ modelName: "[pi] ox-alpha-free", harness: "pi", totalTokens: 5000, estimatedCost: 0, missingPricing: true }),
  model({ modelName: "claude-haiku-4-5", harness: "claude", totalTokens: 2000, verifiedCost: 3, estimatedCost: 3 }),
];

export const PRICES: Record<string, ModelPrice | null> = {
  "claude-opus-5-5": { rates: [4, 20, 5, 0.2], source: "openrouter", match: "claude-opus-5.5" },
  "[pi] ox-alpha-free": null,
  "claude-haiku-4-5": null,
};

export const statusFetchedAgo = (ms: number): PricingStatus => ({
  fetchedAt: new Date(Date.now() - ms).toISOString(),
  models: 346,
  lastDownloadFailed: false,
  offline: false,
});

const day = (models: ModelMetric[]): TimePeriodRow => ({
  period: "2026-10-01",
  label: "Oct 1",
  ...counts,
  totalTokens: models.reduce((a, m) => a + m.totalTokens, 0),
  verifiedCost: models.reduce((a, m) => a + m.verifiedCost, 0),
  estimatedCost: models.reduce((a, m) => a + m.estimatedCost, 0),
  byHarness: {
    all: {
      harness: "claude",
      ...counts,
      totalTokens: 0,
      verifiedCost: 0,
      estimatedCost: 0,
      models,
    },
  },
  modelsUsed: models.map((m) => m.modelName),
});

export function fakeDashboard(over: Partial<Dashboard> = {}): Dashboard {
  const days = [day(MODELS)];
  const estimated = over.estimated ?? false;
  const data: DashboardPayload = {
    generatedAt: "2026-10-02T00:00:00.000Z",
    ccusageVersion: "20.0.24",
    syncingHarnesses: [],
    totals: {
      ...counts,
      totalTokens: 0,
      verifiedCost: 0,
      estimatedCost: 0,
      activeHarnesses: 0,
      installedHarnesses: 0,
      totalHarnesses: 0,
      activeDays: 0,
      totalSessions: 0,
      cacheHitRate: 0,
    },
    harnesses: [],
    daily: days,
    weekly: [],
    monthly: [],
    yearly: [],
    models: MODELS,
    sessions: [],
    pricing: { status: statusFetchedAgo(2 * 60 * 60_000), models: PRICES },
  };
  return {
    data,
    range: { preset: "30d", start: "2026-09-03", end: "2026-10-02" },
    harness: "all",
    setHarness: () => {},
    estimated,
    costOf: (c) => (estimated ? c.estimatedCost : c.verifiedCost),
    days,
    sessions: [],
    series: [],
    seriesOf: (id) => ({ key: id, name: id, color: "#888888" }),
    nameOf: (id) => id,
    search: "",
    openModelPrices: () => {},
    ...over,
  };
}

/** Renders a view inside a dashboard context to HTML. */
export function render(view: ReactElement, over: Partial<Dashboard> = {}): string {
  return renderToStaticMarkup(<DashboardProvider value={fakeDashboard(over)}>{view}</DashboardProvider>);
}
