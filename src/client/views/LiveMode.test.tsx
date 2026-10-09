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
  test("leads with the burn rate by default, with the panels below", () => {
    const html = render(<LiveBoard feed={feed([event({})])} initialLead="cost" />);
    expect(html).toContain('aria-label="Burn rate"');
    expect(html).toContain('lm-hero-figure">$0.48<small>/hr</small>');
    expect(html).toContain("$0.04 per response");
    expect(html).toContain("Tokens / min, incl. cache re-reads");
    for (const heading of ["By tool", "By model", "Output speed", "Sessions", "Responses"]) expect(html).toContain(`>${heading}<`);
    expect(html).toContain('class="lm-tick is-new"');
  });

  test("can lead with new tokens instead, with cache re-reads beside them and the burn rate in the readouts", () => {
    const html = render(<LiveBoard feed={feed([event({})])} initialLead="tokens" />);
    expect(html).toContain("New tokens per minute");
    expect(html).toContain('lm-hero-figure">405</span>');
    expect(html).toContain(">Cache re-reads<");
    expect(html).toContain("120.0<small>K</small>");
    expect(html).toContain("New tokens / min<");
    expect(html).toContain('<span class="lm-label">Burn rate</span>');
  });

  test("shows the largest active context and how many agents are working", () => {
    const html = render(<LiveBoard feed={feed([event({}), event({ id: "e2", session: "s2", project: "other", at: NOW - 5 * 60_000, cacheReadTokens: 900_000 })])} />);
    expect(html).toContain(">Context<");
    expect(html).toContain('<span class="lm-note">other</span>');
    expect(html).toContain(">Agents working<");
    expect(html).toContain("2 in 15 min");
  });

  test("keeps the oldest time label inside the chart", () => {
    expect(render(<LiveBoard feed={feed([event({})])} />)).toContain('class="is-start"');
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

  test("says which tools in use aren't followed live", () => {
    const data = { ...fakeDashboard().data, harnesses: [harness("antigravity", "Antigravity"), harness("opencode", "OpenCode")] };
    const html = render(<LiveBoard feed={feed([])} />, { data });
    expect(html).toContain("Of the tools you use, OpenCode isn&#x27;t followed");
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

  test("draws no speed line from responses before the time span, and keeps it inside the chart", () => {
    // Fast responses just before the 15-minute span used to send the median line far off the top.
    const before = [0, 1, 2].map((i) => event({ id: `b${i}`, at: NOW - 17 * 60_000 + i * 1000, start: NOW - 17 * 60_000 + i * 1000 - 3_000, outputTokens: 3_000 }));
    const empty = render(<LiveBoard feed={feed(before)} />);
    expect(empty).not.toContain('class="lm-median"');

    const inside = [0, 1, 2].map((i) => event({ id: `i${i}`, at: NOW - 60_000 * (i + 1), start: NOW - 60_000 * (i + 1) - 4_000 }));
    const html = render(<LiveBoard feed={feed([...before, ...inside])} />);
    const path = /class="lm-median" d="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(path).not.toBe("");
    for (const [, y] of path.matchAll(/,(-?[\d.]+)/g)) {
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThanOrEqual(180);
    }
  });
});
