import { describe, expect, test } from "bun:test";
import type { HarnessSummary, LiveEvent } from "../../types.ts";
import type { LiveFeed } from "../lib/live.ts";
import { LiveBoard } from "./Live.tsx";
import { fakeDashboard, render } from "../testing/dashboard.tsx";

const NOW = Date.parse("2026-10-08T10:30:20.000Z");

const event = (over: Partial<LiveEvent>): LiveEvent => ({
  id: "e1",
  harness: "claude",
  model: "claude-opus-5-5",
  start: NOW - 6_000,
  at: NOW - 2_000,
  session: "s1",
  project: "token-larper",
  inputTokens: 5,
  outputTokens: 400,
  cacheCreationTokens: 0,
  cacheReadTokens: 120_000,
  cost: 0.04,
  ...over,
});

const feed = (events: LiveEvent[], over: Partial<LiveFeed> = {}): LiveFeed => ({
  status: "live",
  snapshot: { windowMs: 60 * 60_000, tools: ["claude", "codex", "pi", "gemini", "copilot"], files: 3 },
  events,
  now: NOW,
  ...over,
});

const harness = (id: HarnessSummary["meta"]["id"], name: string) =>
  ({ meta: { id, name, hasUsage: true } }) as HarnessSummary;

describe("Live tab", () => {
  test("shows per-minute rates, the session, and the response", () => {
    const html = render(<LiveBoard feed={feed([event({})])} />);
    expect(html).toContain("Tokens / min");
    expect(html).toContain("120.4K");
    expect(html).toContain("Active sessions");
    expect(html).toContain("token-larper");
    expect(html).toContain("≈100 tok/s");
    expect(html).toContain("Following 3 session files");
  });

  test("says which tools in use aren't followed live", () => {
    const data = { ...fakeDashboard().data, harnesses: [harness("claude", "Claude Code"), harness("antigravity", "Antigravity")] };
    const html = render(<LiveBoard feed={feed([])} />, { data, nameOf: (id) => (id === "antigravity" ? "Antigravity" : id) });
    expect(html).toContain("Antigravity keeps its logs in a database");
    expect(html).toContain("No responses in the last hour");
  });

  test("shows only the status until the server has read the last hour", () => {
    const html = render(<LiveBoard feed={feed([], { status: "connecting", snapshot: null })} />);
    expect(html).toContain("Connecting…");
    expect(html).not.toContain("Tokens / min");
  });

  test("narrows to the selected tool", () => {
    const html = render(<LiveBoard feed={feed([event({}), event({ id: "e2", harness: "codex", project: "other-repo" })])} />, { harness: "codex" });
    expect(html).toContain("other-repo");
    expect(html).not.toContain("token-larper");
  });
});
