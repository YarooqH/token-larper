export type HarnessId =
  | "claude"
  | "codex"
  | "antigravity"
  | "pi"
  | "opencode"
  | "gemini"
  | "copilot"
  | "amp"
  | "droid"
  | "codebuff"
  | "hermes"
  | "goose"
  | "kilo"
  | "kimi"
  | "qwen"
  | "openclaw"
  | "grok"
  | "zcode";

export interface HarnessMetadata {
  id: HarnessId;
  name: string;
  vendor: string;
  color: string;
  accentBg: string;
  description: string;
  configPathHint: string;
  installed: boolean;
  hasUsage: boolean;
  syncStatus: "ready" | "syncing" | "idle" | "error";
  lastSyncMs?: number;
}

export interface ModelMetric {
  modelName: string;
  harness: HarnessId;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  verifiedCost: number;
  estimatedCost: number;
  missingPricing: boolean;
}

export interface PeriodHarnessBreakdown {
  harness: HarnessId;
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

export interface TimePeriodRow {
  period: string; // YYYY-MM-DD, YYYY-Www, YYYY-MM, or YYYY
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  verifiedCost: number;
  estimatedCost: number;
  byHarness: Record<string, PeriodHarnessBreakdown>;
  modelsUsed: string[];
}

export interface SessionEntry {
  id: string;
  harness: HarnessId;
  projectPath: string;
  /** Working directory read from the harness's own session files, when it records one. */
  cwd?: string;
  /** Repository root (nearest folder with .git) or the cwd; sessions are grouped by this. */
  projectRoot?: string;
  projectName?: string;
  firstActivity?: string;
  lastActivity?: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  verifiedCost: number;
  estimatedCost: number;
  modelsUsed: string[];
  modelBreakdowns: ModelMetric[];
}

export interface HarnessSummary {
  meta: HarnessMetadata;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  verifiedCost: number;
  estimatedCost: number;
  activeDays: number;
  sessionCount: number;
  lastActiveDate: string | null;
  topModel: string | null;
  cacheHitRate: number;
  models: ModelMetric[];
  unpricedModels: string[];
}

/** A list price in USD per 1M tokens: input, output, cache write, cache read. */
export interface ModelPrice {
  rates: [input: number, output: number, cacheWrite: number, cacheRead: number];
  /** "openrouter": OpenRouter's public price list. "built-in": Anthropic's rates kept in the app. */
  source: "openrouter" | "built-in";
  /** The listed name that matched, e.g. "gpt-5.5" for "gpt-5.5-codex". */
  match: string;
}

export interface PricingStatus {
  /** When the price list in use was downloaded (ISO), or null if none has loaded. */
  fetchedAt: string | null;
  /** How many models the list prices. */
  models: number;
  /** The last download failed, so an older list (or none) is in use. */
  lastDownloadFailed: boolean;
  offline: boolean;
}

export interface DashboardPayload {
  generatedAt: string;
  ccusageVersion: string;
  syncingHarnesses: HarnessId[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    verifiedCost: number;
    estimatedCost: number;
    activeHarnesses: number;
    installedHarnesses: number;
    totalHarnesses: number;
    activeDays: number;
    totalSessions: number;
    cacheHitRate: number;
  };
  harnesses: HarnessSummary[];
  daily: TimePeriodRow[];
  weekly: TimePeriodRow[];
  monthly: TimePeriodRow[];
  yearly: TimePeriodRow[];
  models: ModelMetric[];
  /** List prices for every model in the data (null when none is known), added per request. */
  pricing?: { status: PricingStatus; models: Record<string, ModelPrice | null> };
  sessions: SessionEntry[];
}

export interface StartupConfig {
  enabled: boolean;
  openBrowserOnBoot: boolean;
  port: number;
  registryValue: string | null;
  launcherPath: string;
}

export interface UpdateStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  /** "npm" can update itself; "source" is a git checkout and updates with git pull. */
  source: "npm" | "source";
  error?: string;
}
