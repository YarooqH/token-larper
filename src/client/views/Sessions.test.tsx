import { expect, test } from "bun:test";
import type { HarnessId, SessionEntry } from "../../types.ts";
import { SessionTable } from "./Sessions.tsx";
import { render } from "../testing/dashboard.tsx";

const session = (id: string, harness: HarnessId): SessionEntry => ({
  id,
  harness,
  projectPath: "F:/work/app",
  date: "2026-10-07",
  lastActivity: "2026-10-07T17:08:00.000Z",
  inputTokens: 100,
  outputTokens: 25_000,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 25_100,
  verifiedCost: 0,
  estimatedCost: 0,
  modelsUsed: ["kimi"],
  modelBreakdowns: [],
});

const throughput = {
  byHarness: new Map(),
  byModel: new Map(),
  activeMs: new Map(),
  bySession: new Map([["opencode-ses_1", { responses: 3, tokensPerSecond: 84.8, median: 80, p90: 120, medianWaitMs: 900 }]]),
  timedByTool: new Set<HarnessId>(["opencode"]),
};

test("shows each session's speed with the first-output wait, and a dash when unknown", () => {
  const html = render(<SessionTable sessions={[session("opencode-ses_1", "opencode"), session("claude-x", "claude")]} />, { throughput });
  expect(html).toContain(">Speed<");
  expect(html).toContain("≈84.8 tok/s");
  expect(html).toContain("Only 3 responses in this session");
  expect(html).toContain("Typical wait for the first output: 0.9 s.");
  expect(html).toContain('<td class="num muted">—</td>');
});
