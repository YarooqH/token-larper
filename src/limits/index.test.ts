import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { HarnessLimitCard } from "../types.ts";
import {
  CLAUDE_SIGN_IN_EXPIRED_MESSAGE,
  LIMITS_OFFLINE_MESSAGE,
  buildAntigravityLimitCard,
  buildClaudeSignInExpiredCard,
  buildLimitsOfflineCard,
  buildOpenCodeGoLimitCard,
  clampPercent,
  estimateOpenCodeGoCost,
  extractPiOpenCodeGoEvents,
  formatClaudePlanName,
  getWindowStatus,
  isCacheFresh,
  latestCodexRateLimitsFromText,
  memoizeAsyncTtl,
  mergeWithCache,
  liveMatchesLocal,
  pickActiveAntigravityInstall,
  parseClaudeOAuthUsage,
  parseCodexRolloutRateLimits,
  parseCodexWhamUsage,
  parseCopilotUsage,
  requestQuota,
  withTimeout,
} from "./index.ts";

describe("limits helpers & parsers", () => {
  test("clampPercent and getWindowStatus classify quota states accurately", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(105)).toBe(100);
    expect(clampPercent(44.44)).toBe(44.4);
    expect(getWindowStatus(85)).toBe("ok");
    expect(getWindowStatus(18)).toBe("warning");
    expect(getWindowStatus(5)).toBe("critical");
    expect(getWindowStatus(0)).toBe("critical");
  });

  test("parseClaudeOAuthUsage extracts 5h/7d windows, promo credits, and 7d surface breakdown", () => {
    const card = parseClaudeOAuthUsage(
      {
        five_hour: { utilization: 100.0, resets_at: "2026-10-14T07:09:59Z" },
        seven_day: { utilization: 56.0, resets_at: "2026-10-18T22:59:59Z" },
        seven_day_sonnet: { utilization: 32.5, resets_at: "2026-10-18T22:59:59Z" },
        iguana_necktie: {
          utilization: 0.0,
          resets_at: "2026-11-05T07:59:00Z",
          limit_dollars: 100,
          used_dollars: 0,
          remaining_dollars: 100,
        },
        seven_day_breakdown: {
          rows: [{ key: "claude_code", display_name: "Claude Code", percent: 97 }],
        },
      },
      { subscriptionType: "pro", rateLimitTier: "default_claude_ai" },
    );

    expect(card.harness).toBe("claude");
    expect(card.planName).toBe("Claude Pro");
    expect(card.windows).toHaveLength(3);
    expect(card.windows[0]?.id).toBe("five_hour");
    expect(card.windows[0]?.remainingPercent).toBe(0);
    expect(card.windows[0]?.status).toBe("critical");
    expect(card.windows[1]?.id).toBe("seven_day");
    expect(card.windows[1]?.remainingPercent).toBe(44);
    expect(card.windows[1]?.status).toBe("ok");
    expect(card.credits?.[0]?.remainingText).toBe("$100.00 left");
    expect(card.breakdown?.items[0]).toEqual({ name: "Claude Code", percent: 97 });
  });

  test("formatClaudePlanName includes multiplier tiers when present", () => {
    expect(formatClaudePlanName("max", "default_claude_max_20x")).toBe("Claude Max (20x)");
    expect(formatClaudePlanName("max", "default_claude_max_5x")).toBe("Claude Max (5x)");
    expect(formatClaudePlanName("pro", "default_claude_ai")).toBe("Claude Pro");
  });

  test("parseCodexWhamUsage normalizes primary, secondary, and code review windows", () => {
    const card = parseCodexWhamUsage({
      plan_type: "plus",
      rate_limit: {
        primary_window: {
          used_percent: 25,
          limit_window_seconds: 18000,
          reset_at: 1794000000,
        },
        secondary_window: {
          used_percent: 82,
          limit_window_seconds: 604800,
          reset_at: 1794500000,
        },
      },
      code_review_rate_limit: {
        primary_window: {
          used_percent: 10,
          limit_window_seconds: 604800,
          reset_at: 1794500000,
        },
      },
    });

    expect(card.planName).toBe("ChatGPT Plus");
    expect(card.windows).toHaveLength(3);
    expect(card.windows[0]?.label).toBe("5-hour window");
    expect(card.windows[0]?.remainingPercent).toBe(75);
    expect(card.windows[1]?.label).toBe("7-day weekly");
    expect(card.windows[1]?.remainingPercent).toBe(18);
    expect(card.windows[1]?.status).toBe("warning");
  });

  test("parseCodexRolloutRateLimits resets expired windows to 100% remaining", () => {
    const nowMs = 1_800_000_000_000;
    const card = parseCodexRolloutRateLimits(
      {
        plan_type: "pro",
        primary: {
          used_percent: 90,
          window_minutes: 300,
          resets_at: Math.floor((nowMs - 60_000) / 1000), // already expired
        },
        secondary: {
          used_percent: 40,
          window_minutes: 10080,
          resets_at: Math.floor((nowMs + 86_400_000) / 1000), // future
        },
      },
      nowMs,
    );

    expect(card.windows[0]?.remainingPercent).toBe(100);
    expect(card.windows[0]?.resetsAt).toBeNull();
    expect(card.windows[1]?.remainingPercent).toBe(60);
    expect(card.windows[1]?.resetsAt).not.toBeNull();
  });

  test("buildAntigravityLimitCard groups model families into shared quota pools", () => {
    const nowMs = Date.parse("2026-10-14T03:00:00Z");
    const card = buildAntigravityLimitCard(
      [
        { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", remainingFraction: 0.885, resetTime: "2026-10-14T05:46:01Z" },
        { id: "gemini-3-flash", label: "Gemini 3 Flash", remainingFraction: 0.885, resetTime: "2026-10-14T05:46:01Z" },
        { id: "claude-opus-4-6", label: "Claude Opus 4.6 (Thinking)", remainingFraction: 1, resetTime: "2026-10-14T08:00:00Z" },
        { id: "gpt-oss-120b", label: "GPT-OSS 120B (Medium)", remainingFraction: 1, resetTime: "2026-10-14T08:00:00Z" },
      ],
      {
        tierName: "Google AI Pro",
        availableCredits: 992,
        source: "live",
        nowMs,
      },
    );

    expect(card.planName).toBe("Google AI Pro");
    expect(card.windows).toHaveLength(2);
    expect(card.windows[0]?.label).toBe("Gemini pool");
    expect(card.windows[0]?.remainingPercent).toBe(88.5);
    expect(card.windows[1]?.label).toBe("Claude & GPT pool");
    expect(card.windows[1]?.remainingPercent).toBe(100);
    // An untouched pool reports now + window as its reset; that is not a real reset time.
    expect(card.windows[1]?.resetsAt).toBeNull();
    expect(card.windows[0]?.resetsAt).toBe("2026-10-14T05:46:01Z");
    expect(card.credits?.[0]?.remainingText).toBe("992 left");
  });

  test("buildOpenCodeGoLimitCard computes 5h ($12), 7d ($30), and 30d ($60) rolling caps", () => {
    const nowMs = Date.parse("2026-10-14T12:00:00Z");
    const cost1 = estimateOpenCodeGoCost("glm-5.1", { input: 1_000_000, output: 500_000 }); // $1.4 + $2.2 = $3.60
    expect(cost1).toBeCloseTo(3.6, 5);

    const card = buildOpenCodeGoLimitCard(
      [
        { timestampMs: nowMs - 3600_000, model: "glm-5.1", costUsd: 3.0 }, // 1h ago (in 5h, 7d, 30d)
        { timestampMs: nowMs - 2 * 86400_000, model: "kimi-k2.5", costUsd: 9.0 }, // 2d ago (in 7d, 30d)
        { timestampMs: nowMs - 15 * 86400_000, model: "minimax-m2.7", costUsd: 18.0 }, // 15d ago (in 30d)
      ],
      nowMs,
    );

    expect(card.windows).toHaveLength(3);
    // 5h: $3 / $12 = 25% used -> 75% remaining
    expect(card.windows[0]?.remainingPercent).toBe(75);
    expect(card.windows[0]?.remainingValueText).toBe("$9.00 left");
    // 7d: $12 / $30 = 40% used -> 60% remaining
    expect(card.windows[1]?.remainingPercent).toBe(60);
    expect(card.windows[1]?.remainingValueText).toBe("$18.00 left");
    // 30d: $30 / $60 = 50% used -> 50% remaining
    expect(card.windows[2]?.remainingPercent).toBe(50);
    expect(card.windows[2]?.remainingValueText).toBe("$30.00 left");
    expect(card.breakdown?.items).toHaveLength(3);
    expect(card.note).toBe("Estimated from local logs against list caps");
    expect(card.windows[0]?.sublabel).toBe("$12 rolling cap");
  });

  test("parseCopilotUsage formats monthly chat and completion entitlements", () => {
    const card = parseCopilotUsage({
      copilot_plan: "individual",
      access_type_sku: "free_limited_copilot",
      quota_reset_date_utc: "2026-11-01T00:00:00.000Z",
      quota_snapshots: {
        chat: { entitlement: 200, remaining: 150, percent_remaining: 75, unlimited: false },
        completions: { entitlement: 2000, remaining: 1984, percent_remaining: 99.2, unlimited: false },
      },
    });

    expect(card).not.toBeNull();
    expect(card?.planName).toBe("Copilot Free");
    expect(card?.windows).toHaveLength(2);
    expect(card?.windows[0]?.remainingValueText).toBe("150 left");
    expect(card?.windows[1]?.remainingPercent).toBe(99.2);
  });
});

function makeCard(id: string, updatedAt: string, extra: Partial<HarnessLimitCard> = {}): HarnessLimitCard {
  return {
    id,
    harness: id as HarnessLimitCard["harness"],
    name: id,
    vendor: "test",
    source: "live",
    updatedAt,
    windows: [
      { id: "w", label: "w", usedPercent: 10, remainingPercent: 90, resetsAt: null, status: "ok" },
    ],
    ...extra,
  };
}

describe("mergeWithCache", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const hour = 3600_000;
  const minute = 60_000;

  test("failed provider is carried over as stale with the original updatedAt as staleSince", () => {
    const prev = makeCard("codex", new Date(now - 5 * minute).toISOString(), { note: "keep me", source: "local" });
    const items = mergeWithCache(new Map([["codex", prev]]), new Map([["codex", null]]), now);
    expect(items).toHaveLength(1);
    expect(items[0]?.stale).toBe(true);
    expect(items[0]?.staleSince).toBe(prev.updatedAt);
    expect(items[0]?.note).toBe("keep me");
    expect(items[0]?.source).toBe("local");
    expect(items[0]?.updatedAt).toBe(prev.updatedAt);
  });

  test("an already-stale card keeps its original staleSince", () => {
    const lastGood = new Date(now - 10 * minute).toISOString();
    const prev = makeCard("codex", new Date(now - 5 * minute).toISOString(), { stale: true, staleSince: lastGood });
    const items = mergeWithCache(new Map([["codex", prev]]), new Map([["codex", null]]), now);
    expect(items[0]?.staleSince).toBe(lastGood);
  });

  test("cached cards older than 15 minutes become an unavailable card without numbers", () => {
    const old = makeCard("copilot", new Date(now - 15 * minute - 1000).toISOString());
    const items = mergeWithCache(new Map([["copilot", old]]), new Map([["copilot", null]]), now);
    expect(items).toHaveLength(1);
    expect(items[0]?.windows).toHaveLength(0);
    expect(items[0]?.stale).toBeUndefined();
    expect(items[0]?.error).toBeTruthy();

    const lastGood = new Date(now - 20 * minute).toISOString();
    const alreadyStale = makeCard("copilot", new Date(now - minute).toISOString(), { stale: true, staleSince: lastGood });
    const again = mergeWithCache(new Map([["copilot", alreadyStale]]), new Map([["copilot", null]]), now);
    expect(again[0]?.windows).toHaveLength(0);
  });

  test("a known failure reason is shown, even when nothing was cached", () => {
    const reasons = new Map([["claude", "Anthropic is rate-limiting the usage lookup"]]);
    const items = mergeWithCache(new Map(), new Map([["claude", null]]), now, reasons);
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("Claude Code");
    expect(items[0]?.windows).toHaveLength(0);
    expect(items[0]?.error).toBe("Anthropic is rate-limiting the usage lookup");
  });

  test("a fresh result clears stale flags", () => {
    const lastGood = new Date(now - 5 * minute).toISOString();
    const prev = makeCard("codex", lastGood, { stale: true, staleSince: lastGood });
    const fresh = makeCard("codex", new Date(now).toISOString());
    const items = mergeWithCache(new Map([["codex", prev]]), new Map([["codex", fresh]]), now);
    expect(items).toHaveLength(1);
    expect(items[0]?.stale).toBeUndefined();
    expect(items[0]?.staleSince).toBeUndefined();
    expect(items[0]?.updatedAt).toBe(fresh.updatedAt);
  });

  test("error cards with no windows are kept, and are never carried over as stale", () => {
    const errorCard = buildClaudeSignInExpiredCard({ subscriptionType: "max" }, new Date(now).toISOString());
    const items = mergeWithCache(new Map(), new Map([["claude", errorCard]]), now);
    expect(items).toHaveLength(1);
    expect(items[0]?.windows).toHaveLength(0);
    expect(items[0]?.error).toBe(CLAUDE_SIGN_IN_EXPIRED_MESSAGE);
    expect(items[0]?.planName).toBe("Claude Max");

    const errPrev = new Map([["claude", errorCard]]);
    expect(mergeWithCache(errPrev, new Map([["claude", null]]), now)).toHaveLength(0);
  });

  test("an empty card without an error counts as a failure", () => {
    const prev = makeCard("codex", new Date(now - 5 * minute).toISOString());
    const empty = makeCard("codex", new Date(now).toISOString(), { windows: [] });
    const items = mergeWithCache(new Map([["codex", prev]]), new Map([["codex", empty]]), now);
    expect(items[0]?.stale).toBe(true);
  });

  test("providers with no cache and no result are omitted; order follows the fresh map", () => {
    const a = makeCard("claude", new Date(now).toISOString());
    const b = makeCard("codex", new Date(now).toISOString());
    const items = mergeWithCache(
      new Map(),
      new Map<string, HarnessLimitCard | null>([["claude", a], ["antigravity", null], ["codex", b]]),
      now,
    );
    expect(items.map((i) => i.id)).toEqual(["claude", "codex"]);
  });
});

describe("cache policy and async helpers", () => {
  test("isCacheFresh uses 45s for normal reads and a 10s floor for forced refreshes", () => {
    expect(isCacheFresh(44_000, false)).toBe(true);
    expect(isCacheFresh(46_000, false)).toBe(false);
    expect(isCacheFresh(9_000, true)).toBe(true);
    expect(isCacheFresh(11_000, true)).toBe(false);
  });

  test("memoizeAsyncTtl caches results (including null), dedupes concurrent calls, and expires", async () => {
    let clock = 1_000;
    let calls = 0;
    const read = memoizeAsyncTtl(
      async (key: string) => {
        calls++;
        await Promise.resolve();
        return key === "missing" ? null : `value:${key}`;
      },
      600_000,
      () => clock,
    );

    const [a, b] = await Promise.all([read("x"), read("x")]);
    expect(a).toBe("value:x");
    expect(b).toBe("value:x");
    expect(calls).toBe(1);

    expect(await read("missing")).toBeNull();
    expect(await read("missing")).toBeNull();
    expect(calls).toBe(2);

    clock += 599_000;
    await read("x");
    expect(calls).toBe(2);
    clock += 2_000;
    await read("x");
    expect(calls).toBe(3);
  });

  test("withTimeout rejects slow work and passes fast results through", async () => {
    expect(await withTimeout(Promise.resolve(7), 50)).toBe(7);
    await expect(withTimeout(new Promise<number>(() => {}), 10)).rejects.toThrow("timed out");
  });
});

describe("log extraction helpers", () => {
  test("latestCodexRateLimitsFromText takes the last record and tolerates a cut first line", () => {
    const text = [
      'ary":{"primary":{"used_percent":1}}}', // cut mid-record at the tail boundary
      JSON.stringify({ timestamp: "t1", payload: { rate_limits: { primary: { used_percent: 10 } } } }),
      JSON.stringify({ timestamp: "t2", payload: { rate_limits: { primary: { used_percent: 20 } } } }),
      JSON.stringify({ timestamp: "t3", payload: { type: "other" } }),
    ].join("\n");
    const found = latestCodexRateLimitsFromText(text);
    expect(found?.timestamp).toBe("t2");
    expect(found?.rateLimits.primary?.used_percent).toBe(20);
    expect(latestCodexRateLimitsFromText("not json\n")).toBeNull();
  });

  test("extractPiOpenCodeGoEvents keeps recent opencode-go messages and prices them when cost is missing", () => {
    const cutoff = 1_000_000;
    const text = [
      JSON.stringify({ message: { provider: "opencode-go", model: "glm-5.1", timestamp: 2_000_000, usage: { cost: { total: 0.5 } } } }),
      JSON.stringify({ message: { provider: "oc-sdk-go", model: "glm-5.1", timestamp: 3_000_000, usage: { input: 1_000_000 } } }),
      JSON.stringify({ message: { provider: "opencode-go", model: "glm-5.1", timestamp: 10, usage: { cost: { total: 9 } } } }),
      JSON.stringify({ message: { provider: "anthropic", model: "x", timestamp: 2_000_000 } }),
      "garbage opencode-go",
    ].join("\n");
    const events = extractPiOpenCodeGoEvents(text, cutoff);
    expect(events).toHaveLength(2);
    expect(events[0]?.costUsd).toBe(0.5);
    expect(events[1]?.costUsd).toBeCloseTo(1.4, 5);
  });

  test("buildClaudeSignInExpiredCard has no windows and a clear error", () => {
    const card = buildClaudeSignInExpiredCard();
    expect(card.id).toBe("claude");
    expect(card.windows).toEqual([]);
    expect(card.error).toContain("Claude Code");
  });
});

describe("antigravity account selection", () => {
  const q = (label: string) => ({ id: label, label, remainingFraction: 1, resetTime: null });

  test("the most recently written install is the active account", () => {
    const installs = [
      { app: "Antigravity", dbPath: "a", mtimeMs: Date.parse("2026-05-19T00:00:00Z") },
      { app: "Antigravity IDE", dbPath: "b", mtimeMs: Date.parse("2026-10-14T00:00:00Z") },
    ];
    expect(pickActiveAntigravityInstall(installs)?.app).toBe("Antigravity IDE");
    expect(pickActiveAntigravityInstall([])).toBeNull();
  });

  test("a live answer with none of the active app's Gemini models belongs to another account", () => {
    const ultra = [q("Gemini 3.8 Flash (High)"), q("Claude Opus 4.6 (Thinking)")];
    const proLive = [q("Gemini 3.5 Flash"), q("Gemini 3.1 Pro"), q("Claude Opus 4.6 (Thinking)")];
    expect(liveMatchesLocal(ultra, proLive)).toBe(false);
  });

  test("a live answer that shares a Gemini model matches, ignoring effort suffixes", () => {
    const local = [q("Gemini 3.5 Flash (High)"), q("Gemini 3.1 Pro (Low)")];
    const live = [q("Gemini 3.5 Flash"), q("Gemini 3.1 Pro")];
    expect(liveMatchesLocal(local, live)).toBe(true);
  });

  test("with no Gemini models locally there is nothing to contradict, so live is accepted", () => {
    expect(liveMatchesLocal([q("Claude Opus 4.6")], [q("Gemini 3.5 Flash")])).toBe(true);
    expect(liveMatchesLocal([], [q("Gemini 3.5 Flash")])).toBe(true);
  });

  test("mergeWithCache handles multiple account cards per provider and carries them over when stale", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    const acc1 = makeCard("antigravity:a@example.com", new Date(now - 60_000).toISOString(), {
      harness: "antigravity",
      account: "a@example.com",
    });
    const acc2 = makeCard("antigravity:b@example.com", new Date(now - 60_000).toISOString(), {
      harness: "antigravity",
      account: "b@example.com",
    });
    const freshItems = mergeWithCache(new Map(), new Map([["antigravity", [acc1, acc2]]]), now);
    expect(freshItems.map((i) => i.id)).toEqual(["antigravity:a@example.com", "antigravity:b@example.com"]);

    const prevMap = new Map(freshItems.map((i) => [i.id, i]));
    const staleItems = mergeWithCache(prevMap, new Map([["antigravity", []]]), now);
    expect(staleItems).toHaveLength(2);
    expect(staleItems[0]?.stale).toBe(true);
    expect(staleItems[1]?.stale).toBe(true);
  });
});

describe("offline mode", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const stubFetch = () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response("{}");
    }) as typeof fetch;
    return urls;
  };

  test("requestQuota sends nothing while offline", async () => {
    const urls = stubFetch();
    await expect(requestQuota("https://api.github.com/copilot_internal/user", {}, true)).rejects.toThrow(LIMITS_OFFLINE_MESSAGE);
    expect(urls).toEqual([]);
  });

  test("requestQuota makes the request while online", async () => {
    const urls = stubFetch();
    const res = await requestQuota("https://chatgpt.com/backend-api/wham/usage", {}, false);
    expect(res.ok).toBe(true);
    expect(urls).toEqual(["https://chatgpt.com/backend-api/wham/usage"]);
  });

  test("every vendor request in the limits module goes through requestQuota", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source.split("fetch(")).toHaveLength(2);
    const start = source.indexOf("export async function requestQuota");
    const gate = source.slice(start, source.indexOf("export function buildLimitsOfflineCard"));
    expect(gate).toContain("fetch(");
  });

  test("an offline card has no numbers and no error, and is kept over a stale snapshot", () => {
    const card = buildLimitsOfflineCard({ id: "copilot", harness: "copilot", name: "Copilot", vendor: "GitHub", account: "octo" });
    expect(card.offline).toBe(true);
    expect(card.windows).toEqual([]);
    expect(card.error).toBeUndefined();

    const now = Date.parse("2026-10-14T12:00:00Z");
    const cached = makeCard("copilot", new Date(now - 60_000).toISOString());
    const items = mergeWithCache(new Map([["copilot", cached]]), new Map([["copilot", [card]]]), now);
    expect(items).toHaveLength(1);
    expect(items[0]?.offline).toBe(true);
    expect(items[0]?.stale).toBeUndefined();
  });
});
