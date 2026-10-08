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

/** Speed counts that add up across days, models or files. */
export interface SpeedTotals {
  responses: number;
  outputTokens: number;
  /** Time from sending each request to its last token. */
  ms: number;
  /** Sparse histogram of per-response tok/s, keyed by rateBin(). */
  hist: Record<number, number>;
  /** Sparse histogram of the wait for the first output, keyed by waitBin(), for tools that record it. */
  waits?: Record<number, number>;
}

/** Output speed for one tool and model on one local day, from the tool's own session files. */
export interface ThroughputRow extends SpeedTotals {
  day: string; // YYYY-MM-DD
  harness: HarnessId;
  model: string;
}

/** How long a tool was working on one local day, with idle gaps left out. */
export interface ActivityRow {
  day: string;
  harness: HarnessId;
  activeMs: number;
}

export interface ThroughputPayload {
  /** "scanning" until the first pass over the session files finishes. */
  status: "ready" | "scanning";
  scannedAt: string | null;
  /**
   * Tools that record when each request was sent and finished; the rest are inferred from
   * log order. Either way the time includes waiting for the first token.
   */
  timedByTool: HarnessId[];
  rows: ThroughputRow[];
  activity: ActivityRow[];
  /** Speed per session over its whole life, keyed like SessionEntry.id ("<harness>-<sessionId>"). */
  sessions: Record<string, SpeedTotals>;
}

/** One model response read from a tool's session file as it was written. */
export interface LiveEvent {
  /** Stays the same when a response that is still streaming is sent again with larger counts. */
  id: string;
  harness: HarnessId;
  model: string;
  /** When the request went out, when the log shows it. */
  start?: number;
  /** When the latest token of the response was logged. */
  at: number;
  session?: string;
  /** The working folder's name, when the log records one. */
  project?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Thinking a tool reports apart from output (Antigravity). It counts toward speed but not toward totals, as in ccusage's numbers. */
  reasoningTokens?: number;
  /** At list prices; 0 for a model with no known price. */
  cost: number;
}

/** The Claude plan's usage limits, from the Claude desktop app's latest sample. */
export interface PlanUsage {
  /** When the app took the sample. */
  at: number;
  /** Percent of the 5-hour limit used. */
  fiveHour: number | null;
  /** Percent of the weekly limit used. */
  weekly: number | null;
}

/** The first message on /api/live: every response in the window, and what is being followed. */
export interface LiveSnapshot {
  windowMs: number;
  /** Tools whose session files are followed live. */
  tools: HarnessId[];
  /** Session files written to within the window. */
  files: number;
  events: LiveEvent[];
  /** Null when the Claude desktop app has no plan samples on this computer. */
  plan: PlanUsage | null;
}

/** Later messages on /api/live: responses that are new or have grown. */
export interface LiveUpdate {
  files: number;
  events: LiveEvent[];
  /** Present when the plan sample changed. */
  plan?: PlanUsage | null;
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
