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
  sessions: SessionEntry[];
}

export interface StartupConfig {
  enabled: boolean;
  openBrowserOnBoot: boolean;
  port: number;
  registryValue: string | null;
  launcherPath: string;
}
