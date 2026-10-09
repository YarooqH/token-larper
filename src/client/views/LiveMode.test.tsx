import { describe, expect, test } from "bun:test";
import type { HarnessSummary, LiveEvent } from "../../types.ts";
import type { LiveFeed } from "../lib/live.ts";
import { LiveBoard } from "./LiveMode.tsx";
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
  snapshot: { windowMs: 60 * 60_000, tools: ["claude", "codex", "pi", "gemini", "copilot", "antigravity"], files: 3 },
  events,
  now: NOW,
  ...over,
});

const harness = (id: HarnessSummary["meta"]["id"], name: string) => ({ meta: { id, name, hasUsage: true } }) as HarnessSummary;

describe("Live mode", () => {
  test("leads with tokens per minute and shows the tape, tools, models, speed, sessions and feed", () => {
    const html = render(<LiveBoard feed={feed([event({})])} />);
    expect(html).toContain("Tokens per minute");
    expect(html).toContain('lm-hero-figure">120.4<small>K</small>');
    for (const heading of ["By tool", "By model", "Output speed", "Sessions", "Responses"]) expect(html).toContain(`>${heading}<`);
    expect(html).toContain("token-larper");
    expect(html).toContain('class="lm-tick is-new"');
  });

  test("shows a session's context size from its latest prompt", () => {
    const html = render(<LiveBoard feed={feed([event({})])} />);
    expect(html).toContain(">Context<");
    expect(html).toContain("120.0<small>K</small>");
  });

  test("offers a tool switch only when more than one tool is live", () => {
    expect(render(<LiveBoard feed={feed([event({})])} />)).not.toContain('aria-label="Tool"');
    const two = render(<LiveBoard feed={feed([event({}), event({ id: "e2", harness: "codex" })])} />);
    expect(two).toContain('aria-label="Tool"');
  });

  test("says which tools in use aren't followed live, and how to leave", () => {
    const data = { ...fakeDashboard().data, harnesses: [harness("antigravity", "Antigravity"), harness("opencode", "OpenCode")] };
    const html = render(<LiveBoard feed={feed([])} />, { data });
    expect(html).toContain("OpenCode isn&#x27;t followed live");
    expect(html).toContain("Of the tools you use, OpenCode isn&#x27;t followed");
    expect(html).toContain("Press Esc to leave Live mode");
    expect(html).toContain("Each response lands here as it finishes");
  });

  test("shows only a connecting state until the server has read the last hour", () => {
    const html = render(<LiveBoard feed={feed([], { status: "connecting", snapshot: null })} />);
    expect(html).toContain("Connecting");
    expect(html).not.toContain("Tokens per minute");
  });

  test("lists what Live mode can't see", () => {
    const html = render(<LiveBoard feed={feed([])} />);
    expect(html).toContain("What Live mode can&#x27;t see");
    expect(html).toContain("Claude chats.");
    expect(html).toContain("API list prices");
    expect(html).toContain('id="live-limitations"');
    expect(html).toContain('aria-controls="live-limitations"');
    expect(html).not.toContain("plan meter");
  });
});
