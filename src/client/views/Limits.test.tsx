import { describe, expect, test } from "bun:test";
import React from "react";
import type { HarnessLimitCard, LimitsPayload, QuotaWindow } from "../../types.ts";
import { render } from "../testing/dashboard.tsx";
import {
  cardNeedsAttention,
  clampPercent,
  formatAge,
  formatPercent,
  formatResetCountdown,
  isFreePlan,
  Limits,
  LimitsSummaryStrip,
  pickHeadlineCredit,
  pickPrimaryWindow,
  sortCards,
  sortWindows,
  windowPercents,
  windowStatusText,
} from "./Limits.tsx";

const NOW = Date.parse("2026-10-14T03:00:00Z");

const sampleLimits: LimitsPayload = {
  generatedAt: "2026-10-14T03:00:00Z",
  items: [
    {
      id: "claude",
      harness: "claude",
      name: "Claude Code",
      vendor: "Anthropic",
      account: "user@example.com",
      planName: "Claude Pro",
      source: "live",
      sourceLabel: "Anthropic OAuth",
      updatedAt: "2026-10-14T03:00:00Z",
      windows: [
        {
          id: "five_hour",
          label: "5-hour window",
          sublabel: "Rolling 5h block",
          usedPercent: 100,
          remainingPercent: 0,
          resetsAt: "2026-10-14T07:00:00Z",
          windowSeconds: 18000,
          status: "critical",
        },
        {
          id: "seven_day",
          label: "7-day weekly",
          sublabel: "All models",
          usedPercent: 56,
          remainingPercent: 44,
          resetsAt: "2026-10-18T23:00:00Z",
          windowSeconds: 604800,
          status: "ok",
        },
      ],
      credits: [
        {
          label: "Promo credit",
          remainingText: "$100.00 left",
          usedText: "$0.00",
          limitText: "$100.00",
          resetsAt: "2026-11-05T07:59:00Z",
        },
      ],
      breakdown: {
        label: "7-day usage by surface",
        items: [
          { name: "Claude Code", percent: 97 },
          { name: "Chats", percent: 3 },
        ],
      },
    },
    {
      id: "opencode",
      harness: "opencode",
      name: "OpenCode Go",
      vendor: "Anomaly",
      planName: "OpenCode Go",
      source: "local",
      sourceLabel: "Local rolling ledger",
      updatedAt: "2026-10-14T03:00:00Z",
      note: "Estimated from local logs against list caps",
      windows: [
        {
          id: "thirty_day",
          label: "30-day monthly",
          sublabel: "$60 rolling cap",
          usedPercent: 3.3,
          remainingPercent: 96.7,
          usedValueText: "$1.98",
          limitValueText: "$60.00",
          remainingValueText: "$58.02 left",
          resetsAt: "2026-10-17T00:00:00Z",
          windowSeconds: 2592000,
          status: "ok",
        },
      ],
    },
  ],
};

const win = (over: Partial<QuotaWindow> = {}): QuotaWindow => ({
  id: "w",
  label: "Window",
  usedPercent: 10,
  remainingPercent: 90,
  resetsAt: "2026-10-14T05:00:00Z",
  windowSeconds: 18000,
  status: "ok",
  ...over,
});

const card = (over: Partial<HarnessLimitCard> = {}): HarnessLimitCard => ({
  id: "c",
  harness: "claude",
  name: "Card",
  vendor: "Vendor",
  source: "live",
  updatedAt: "2026-10-14T03:00:00Z",
  windows: [win()],
  ...over,
});

const payload = (items: HarnessLimitCard[], generatedAt = "2026-10-14T03:00:00Z"): LimitsPayload => ({ generatedAt, items });

/** Static markup escapes apostrophes; compare against plain text. */
const view = (el: React.ReactElement, over?: Parameters<typeof render>[1]) => render(el, over).replaceAll("&#x27;", "'");

describe("Limits helpers", () => {
  test("formatResetCountdown formats minutes, hours, and days cleanly", () => {
    expect(formatResetCountdown("2026-10-14T03:25:00Z", NOW)).toBe("25m");
    expect(formatResetCountdown("2026-10-14T06:45:00Z", NOW)).toBe("3h 45m");
    expect(formatResetCountdown("2026-10-16T08:00:00Z", NOW)).toBe("2d 5h");
    expect(formatResetCountdown("2026-10-14T02:59:00Z", NOW)).toBe("Resetting now");
    expect(formatResetCountdown("not a date", NOW)).toBeNull();
  });

  test("pickPrimaryWindow selects the tightest warning/critical window when present", () => {
    const primary = pickPrimaryWindow(sampleLimits.items[0]!);
    expect(primary?.id).toBe("five_hour");
    expect(primary?.remainingPercent).toBe(0);
  });

  test("pickPrimaryWindow falls back to the shortest window and survives zero windows", () => {
    const healthy = card({
      windows: [win({ id: "week", windowSeconds: 604800 }), win({ id: "five", windowSeconds: 18000 })],
    });
    expect(pickPrimaryWindow(healthy)?.id).toBe("five");
    expect(pickPrimaryWindow(card({ windows: [], error: "boom" }))).toBeNull();
  });

  test("percent helpers clamp negative, over-range and non-numeric values", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(undefined)).toBe(0);
    expect(formatPercent(0.3)).toBe("<1");
    expect(formatPercent(99.6)).toBe("99");
    expect(formatPercent(100)).toBe("100");
    expect(formatPercent(96.7)).toBe("97");
    expect(windowPercents({ remainingPercent: Number.NaN, usedPercent: 30 })).toEqual({ remaining: 70, used: 30, known: true });
    expect(windowPercents({ remainingPercent: Number.NaN, usedPercent: Number.NaN }).known).toBe(false);
  });

  test("windowStatusText pairs colour with a short word", () => {
    expect(windowStatusText(win())).toBeNull();
    expect(windowStatusText(win({ status: "warning", remainingPercent: 15 }))).toBe("Low");
    expect(windowStatusText(win({ status: "critical", remainingPercent: 0 }))).toBe("Limit reached");
    expect(windowStatusText(win({ status: "critical", remainingPercent: 3 }))).toBe("Almost out");
  });

  test("formatAge gives short relative times and null for junk", () => {
    expect(formatAge("2026-10-14T02:59:40Z", NOW)).toBe("just now");
    expect(formatAge("2026-10-14T02:48:00Z", NOW)).toBe("12m ago");
    expect(formatAge("2026-10-14T00:00:00Z", NOW)).toBe("3h ago");
    expect(formatAge("2026-10-10T03:00:00Z", NOW)).toBe("4d ago");
    expect(formatAge("not a date", NOW)).toBeNull();
    expect(formatAge(undefined, NOW)).toBeNull();
  });

  test("sortWindows puts the shortest window first and unknown lengths last, keeping ties stable", () => {
    const sorted = sortWindows([
      win({ id: "unknown", windowSeconds: undefined }),
      win({ id: "week", windowSeconds: 604800 }),
      win({ id: "five_a", windowSeconds: 18000 }),
      win({ id: "five_b", windowSeconds: 18000 }),
      win({ id: "nan", windowSeconds: Number.NaN }),
    ]);
    expect(sorted.map((w) => w.id)).toEqual(["five_a", "five_b", "week", "unknown", "nan"]);
  });

  test("sortCards orders attention first, then groups by name (live before local within a tool)", () => {
    const sorted = sortCards([
      card({ id: "local-a", name: "Alpha", source: "local" }),
      card({ id: "live-a", name: "Alpha", source: "live" }),
      card({ id: "live-z", name: "Zed", source: "live" }),
      card({ id: "live-b", name: "beta", source: "live" }),
      card({ id: "warn", name: "Warned", source: "local", windows: [win({ status: "warning", remainingPercent: 15 })] }),
      card({ id: "err", name: "Broken", source: "live", windows: [], error: "expired" }),
      card({ id: "crit", name: "Critical", source: "local", windows: [win({ status: "critical", remainingPercent: 0 })] }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["crit", "err", "warn", "live-a", "local-a", "live-b", "live-z"]);
  });

  test("isFreePlan identifies free subscription tiers", () => {
    expect(isFreePlan({ planName: "ChatGPT Free" })).toBe(true);
    expect(isFreePlan({ planName: "Copilot Free" })).toBe(true);
    expect(isFreePlan({ planName: "Claude Pro" })).toBe(false);
    expect(isFreePlan({ planName: "Google AI Ultra" })).toBe(false);
    expect(isFreePlan({ planName: undefined })).toBe(false);
  });

  test("cardNeedsAttention covers flagged windows and unreadable providers", () => {
    expect(cardNeedsAttention(card())).toBe(false);
    expect(cardNeedsAttention(card({ windows: [win({ status: "warning" })] }))).toBe(true);
    expect(cardNeedsAttention(card({ windows: [], error: "no token" }))).toBe(true);
    expect(cardNeedsAttention(card({ windows: [] }))).toBe(false);
  });

  test("pickHeadlineCredit prefers the bucket expiring soonest", () => {
    const credits = [
      { label: "A", remainingText: "$5", resetsAt: "2026-12-01T00:00:00Z" },
      { label: "B", remainingText: "$9", resetsAt: "2026-10-20T00:00:00Z" },
      { label: "C", remainingText: "$1", resetsAt: null },
    ];
    expect(pickHeadlineCredit(credits, NOW)?.label).toBe("B");
    expect(pickHeadlineCredit([credits[2]!], NOW)?.label).toBe("C");
    expect(pickHeadlineCredit([], NOW)).toBeNull();
  });
});

describe("Limits view", () => {
  test("shows only the updated time and Refresh in the header, with no KPIs, filters or toggles", () => {
    const html = view(<Limits limits={sampleLimits} now={NOW} onRefresh={() => {}} />);
    expect(html).toContain("Updated ");
    expect(html).toContain("<span>Refresh</span>");
    for (const gone of ["kpi", "Connected plans", "Tightest window", "Remaining %", "Used %", "All plans", "Attention", "segmented", "limits-legend"]) {
      expect(html).not.toContain(gone);
    }
  });

  test("a card has consistent header (title, account, plan badge), windows, and credit row without Live/Local dots", () => {
    const html = view(<Limits limits={sampleLimits} now={NOW} />);
    expect(html).toContain("Claude Pro");
    expect(html).toContain("user@example.com");
    expect(html).toContain("OpenCode Go");
    expect(html).toContain("5-hour window");
    expect(html).toContain("0% left");
    expect(html).toContain("44% left");
    expect(html).toContain("<span>Promo credit</span><strong>$100.00 left</strong>");
    expect(html).not.toContain(">Live<");
    expect(html).not.toContain(">Local<");
    expect(html).not.toContain("limit-breakdown");
    for (const gone of ["Anthropic", "Anomaly", "Anthropic OAuth", "Local rolling ledger", "Rolling 5h block", "$60 rolling cap", "% of window consumed", "Running low"]) {
      expect(html).not.toContain(gone);
    }
  });

  test("a window has a consistent label, percent left, bar, and footer with percent used and reset", () => {
    const html = view(<Limits limits={sampleLimits} now={NOW} />);
    expect(html.indexOf("5-hour window")).toBeLessThan(html.indexOf("7-day weekly"));
    expect(html).toContain("Resets in 4d 20h");
    expect(html).toContain("<span>3% used ($1.98 / $60.00)</span><span>Resets in 2d 21h</span>");
    expect(html).toContain("<span>56% used</span><span>Resets in 4d 20h</span>");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuetext="44% left, resets in 4d 20h"');
    expect(html).toContain("limit-bar-fill");
    expect(html).not.toContain("limit-bar-pace");
  });

  test("hides free subscriptions by default and shows a Show free toggle button", () => {
    const withFree = payload([
      ...sampleLimits.items,
      card({ id: "codex", harness: "codex", name: "Codex", account: "user@example.com", planName: "ChatGPT Free" }),
      card({ id: "copilot", harness: "copilot", name: "Copilot", account: "ghuser", planName: "Copilot Free" }),
    ]);
    const hiddenHtml = view(<Limits limits={withFree} now={NOW} />);
    expect(hiddenHtml).toContain("Claude Pro");
    expect(hiddenHtml).not.toContain("ChatGPT Free");
    expect(hiddenHtml).not.toContain("Copilot Free");
    expect(hiddenHtml).toContain("Show free (2)");

    const shownHtml = view(<Limits limits={withFree} now={NOW} showFree />);
    expect(shownHtml).toContain("ChatGPT Free");
    expect(shownHtml).toContain("Copilot Free");
    expect(shownHtml).toContain("Hide free (2)");
  });

  test("renders multiple accounts for the same provider with distinct account labels", () => {
    const multi = payload([
      card({ id: "antigravity:a", harness: "antigravity", name: "Antigravity", account: "ultra@example.com", planName: "Google AI Ultra" }),
      card({ id: "antigravity:b", harness: "antigravity", name: "Antigravity", account: "pro@example.com", planName: "Google AI Pro" }),
    ]);
    const html = view(<Limits limits={multi} now={NOW} />);
    expect(html).toContain("ultra@example.com");
    expect(html).toContain("pro@example.com");
    expect(html).toContain("Google AI Ultra");
    expect(html).toContain("Google AI Pro");
  });

  test("critical and warning windows carry a word as well as colour, and the progressbar says it", () => {
    const html = view(<Limits limits={sampleLimits} now={NOW} />);
    expect(html).toContain("Limit reached");
    expect(html).toContain('aria-valuetext="0% left, resets in 4h, limit reached"');
    const warned = view(<Limits limits={payload([card({ windows: [win({ status: "warning", remainingPercent: 15 })] })])} now={NOW} />);
    expect(warned).toContain("Low");
    expect(warned).toContain("limit-card is-warning");
  });

  test("does not apply the global tool filter, since the picker is hidden on this view", () => {
    const html = view(<Limits limits={sampleLimits} now={NOW} />, { harness: "claude" });
    expect(html).toContain("Claude Pro");
    expect(html).toContain("OpenCode Go");
  });

  test("a stale card says only Stale, keeps its countdowns, and dims via is-stale", () => {
    const stale = card({
      id: "stale",
      name: "Stale Tool",
      stale: true,
      staleSince: "2026-10-14T02:48:00Z",
      windows: [win({ resetsAt: "2026-10-14T05:00:00Z" })],
    });
    const html = view(<Limits limits={payload([stale])} now={NOW} />);
    expect(html).toContain("Stale");
    expect(html).toContain('title="Last updated 12m ago"');
    expect(html).toContain("limit-card is-stale");
    expect(html).not.toContain("limit-status is-live");
    expect(html).toContain("Resets in 2h");
  });

  test("a stale card without a usable staleSince still says Stale", () => {
    const html = view(<Limits limits={payload([card({ stale: true, staleSince: "garbage" })])} now={NOW} />);
    expect(html).toContain("Stale");
    expect(html).not.toContain("title=");
  });

  test("an error-only card is the title row and one error line", () => {
    const broken = card({ id: "broken", name: "Claude Code", windows: [], error: "Sign-in expired (401)" });
    const html = view(<Limits limits={payload([broken])} now={NOW} />);
    expect(html).toContain("Unavailable");
    expect(html).toContain('<p class="limit-error-line">Sign-in expired (401)</p>');
    expect(html).not.toContain("Couldn't read this quota");
    expect(html).not.toContain("is signed in on this machine");
    expect(html).not.toContain("limit-windows");
    expect(html).not.toContain("limit-card-foot");
  });

  test("a card with neither windows nor an error says there is no data yet", () => {
    const html = view(<Limits limits={payload([card({ windows: [] })])} now={NOW} />);
    expect(html).toContain("No quota data yet.");
    expect(html).not.toContain("limit-error-line");
  });

  test("a card skipped by offline mode says so, without an error", () => {
    const html = view(<Limits limits={payload([card({ windows: [], offline: true })])} now={NOW} />);
    expect(html).toContain("Offline mode is on. Turn it off in Settings → Privacy to check this quota.");
    expect(html).toContain(">Offline</span>");
    expect(html).not.toContain("Unavailable");
    expect(html).not.toContain("No quota data yet.");
    expect(html).not.toContain("is-error");
  });

  test("the generic local-ledger note renders nothing, while a useful note stays small and muted", () => {
    const generic = view(<Limits limits={payload([card({ source: "local", note: "Estimated from local logs against list caps" })])} now={NOW} />);
    expect(generic).not.toContain("Estimated from local logs");
    expect(generic).not.toContain("limit-card-foot");
    const useful = view(<Limits limits={payload([card({ source: "local", note: "Live quota needs Windows Credential Manager" })])} now={NOW} />);
    expect(useful).toContain('<p class="limit-line">Live quota needs Windows Credential Manager</p>');
  });

  test("an error on a card that still has windows is one line in the footer", () => {
    const html = view(<Limits limits={payload([card({ error: "timeout" })])} now={NOW} />);
    expect(html).toContain("Last refresh failed: timeout");
    expect(html).toContain("limit-windows");
  });

  test("extra credits are one row per card: the soonest-expiring bucket with a count of the rest", () => {
    const html = view(
      <Limits
        limits={payload([
          card({
            id: "b",
            name: "Beta",
            credits: [
              { label: "Promo", remainingText: "$9.00 left", resetsAt: "2026-10-20T00:00:00Z" },
              { label: "Flex", remainingText: "12 credits" },
            ],
          }),
        ])}
        now={NOW}
      />,
    );
    expect(html).toContain('<div class="limit-credit-row"><span>Promo</span><strong>$9.00 left (+1 more)</strong></div>');
  });

  test("the header flags an old payload with a short age and nothing else", () => {
    const old = view(<Limits limits={payload([card()], "2026-10-14T02:40:00Z")} now={NOW} />);
    expect(old).toContain("Updated 20m ago");
    expect(old).toContain("limits-updated is-old");
    expect(old).not.toContain("out of date");
    const fresh = view(<Limits limits={payload([card()])} now={NOW} />);
    expect(fresh).toContain("Updated ");
    expect(fresh).not.toContain("ago");
    expect(fresh).not.toContain("is-old");
  });

  test("cards render in priority order regardless of payload order", () => {
    const html = view(
      <Limits
        limits={payload([
          card({ id: "a", name: "Aaa Healthy" }),
          card({ id: "z", name: "Zzz Critical", windows: [win({ status: "critical", remainingPercent: 0 })] }),
        ])}
        now={NOW}
      />,
    );
    expect(html.indexOf("Zzz Critical")).toBeLessThan(html.indexOf("Aaa Healthy"));
  });

  test("an empty payload is one sentence with no list", () => {
    const html = view(<Limits limits={payload([])} now={NOW} onRefresh={() => {}} />);
    expect(html).toContain("No quota sources found. Sign in to Claude Code, Codex, Copilot or Antigravity.");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("<h3");
  });

  test("loading is the skeleton alone, and a failed first load is one line with Retry", () => {
    const loading = view(<Limits limits={null} />);
    expect(loading).toContain("skel");
    expect(loading).toContain("Loading quotas");
    expect(loading).not.toContain("kpi");
    const failed = view(<Limits limits={null} error="HTTP 500" onRefresh={() => {}} />);
    expect(failed).toContain("Couldn't load quotas (HTTP 500).");
    expect(failed).toContain("Retry");
    expect(failed).not.toContain("<h3");
  });

  test("a failed refresh over existing data keeps the cards and says so", () => {
    const html = view(<Limits limits={sampleLimits} error="HTTP 502" now={NOW} />);
    expect(html).toContain("Couldn't refresh (HTTP 502). Showing the last result.");
    expect(html).toContain("Claude Pro");
  });
});

describe("strip rows", () => {
  test("each row is tool, bar, value and note, with a neutral bar unless the window is low", () => {
    const html = view(<LimitsSummaryStrip limits={sampleLimits} onOpenLimits={() => {}} now={NOW} />);
    expect(html).toContain("limits-row-tool");
    expect(html).toContain("limits-row-bar");
    expect(html).toContain("limits-row-value");
    expect(html).toContain("limits-row-note");
    expect(html).toContain("background:var(--text-2)");
    expect(html).toContain("background:var(--error-text)");
    expect(html).not.toContain("limits-mini");
  });

  test("two accounts of one tool are told apart by the account", () => {
    const html = view(
      <LimitsSummaryStrip
        limits={payload([
          card({ id: "a", name: "Antigravity", planName: "Google AI Ultra", account: "ultra@example.com" }),
          card({ id: "b", name: "Antigravity", planName: "Google AI Pro", account: "pro@example.com" }),
        ])}
        onOpenLimits={() => {}}
        now={NOW}
      />,
    );
    expect(html).toContain("ultra@example.com");
    expect(html).toContain("pro@example.com");
  });

  test("an error row says Unavailable and keeps the message as its note", () => {
    const html = view(
      <LimitsSummaryStrip
        limits={payload([card({ id: "bad", name: "Expired Tool", planName: "Pro", windows: [], error: "Sign in again." })])}
        onOpenLimits={() => {}}
        now={NOW}
      />,
    );
    expect(html).toContain("Unavailable");
    expect(html).toContain("Sign in again.");
  });

  test("an offline row says Offline, not Unavailable", () => {
    const html = view(
      <LimitsSummaryStrip limits={payload([card({ windows: [], offline: true })])} onOpenLimits={() => {}} now={NOW} />,
    );
    expect(html).toContain(">Offline<");
    expect(html).toContain("Offline mode is on");
    expect(html).not.toContain("Unavailable");
  });
});

describe("local session block", () => {
  const blockCard = card({
    id: "claude",
    harness: "claude",
    name: "Claude Code",
    source: "local",
    windows: [],
    note: "Claude sign-in expired. Open Claude Code once to refresh it. Session estimated from local logs.",
    block: { startsAt: "2026-10-14T01:30:00Z", endsAt: "2026-10-14T06:30:00Z", messages: 127, tokens: 867_389 },
  });

  test("a card shows the session reset, progress bar, and activity, with no percentage and no empty-state text", () => {
    const html = view(<Limits limits={payload([blockCard])} now={NOW} />);
    expect(html).toContain("5-hour window");
    expect(html).toContain("Resets in 3h 30m");
    expect(html).toContain("127 messages");
    expect(html).toContain("867.4K tokens");
    expect(html).toContain("limit-bar-track");
    expect(html).toContain("Claude sign-in expired.");
    expect(html).not.toContain("% left");
    expect(html).not.toContain("No quota data yet");
    expect(html).not.toContain("Unavailable");
  });

  test("the strip row shows the session end instead of dropping the plan", () => {
    const html = view(<LimitsSummaryStrip limits={payload([blockCard])} onOpenLimits={() => {}} now={NOW} />);
    expect(html).toContain("Claude Code");
    expect(html).toContain("Session");
    expect(html).toContain("Ends in 3h 30m");
    expect(html).not.toContain("No data");
    expect(html).not.toContain("% left");
  });

  test("a single message and a bad token count do not break the line", () => {
    const odd = { ...blockCard, block: { ...blockCard.block!, messages: 1, tokens: Number.NaN } };
    const html = view(<Limits limits={payload([odd])} now={NOW} />);
    expect(html).toContain("1 message ·");
    expect(html).not.toContain("NaN");
  });
});

describe("Limits worst-case data", () => {
  const longName = "Anthropic Claude Code for Teams Enterprise Premium (Northwind Industries Holdings, EMEA region)";
  const worst = payload([
    card({
      id: "worst",
      name: longName,
      vendor: "A vendor with a rather long legal name, Incorporated",
      planName: "Max 20x with the extended-context research preview add-on and priority access",
      sourceLabel: "bartholomew.fitzgerald@northwind-industries-holdings.example.com",
      windows: [
        win({ id: "a", label: "Window a", remainingPercent: 100, usedPercent: 0, status: "ok" }),
        win({ id: "b", label: "Window b", remainingPercent: 0, usedPercent: 100, status: "critical" }),
        win({ id: "c", label: "Window c", remainingPercent: -12, usedPercent: 112, status: "critical" }),
        win({ id: "d", label: "Window d", remainingPercent: 140, usedPercent: -40, status: "ok" }),
        win({ id: "e", label: "Window e", remainingPercent: null as unknown as number, usedPercent: null as unknown as number }),
        win({ id: "f", label: "Gemini 3 Pro (High) - experimental long model pool label", sublabel: "x".repeat(120), remainingPercent: 0.2, usedPercent: 99.8, status: "warning" }),
        win({ id: "f", label: "Duplicate id", resetsAt: "not a date", windowSeconds: Number.NaN }),
        win({ id: "g", label: "No reset", resetsAt: null, windowSeconds: undefined }),
      ],
      credits: [{ label: "A very long promotional credit bucket name", remainingText: "1,234,567.89 credits left", limitText: "2,000,000" }],
      breakdown: { label: "Usage by surface", items: [{ name: "same", percent: Number.NaN }, { name: "same", percent: 12 }] },
    }),
    card({ id: "stale", name: "Stale Tool", stale: true, staleSince: "2026-10-14T02:00:00Z" }),
    card({ id: "broken", name: "Broken Tool", windows: [], error: "x".repeat(200) }),
    card({ id: "empty", name: "Empty Tool", windows: [] }),
    ...Array.from({ length: 8 }, (_, i) => card({ id: `many-${i}`, name: `Plan ${i}` })),
  ]);

  test("renders every window, never prints NaN or a negative percent, and keeps duplicate ids apart", () => {
    const html = view(<Limits limits={worst} now={NOW} />);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("-12%");
    expect(html).not.toContain("140%");
    expect(html).not.toContain("112%");
    expect(html).toContain("Duplicate id");
    expect(html).toContain("No data");
    expect(html).toContain("&lt;1% left");
    expect(html).toContain("100% left");
    expect(html).toContain("0% left");
    expect(html).toContain(longName);
    expect(html).toContain("Stale Tool");
    expect(html).toContain("Broken Tool");
    expect(html).toContain("Empty Tool");
  });

  test("worst-case ids do not collide in React keys", () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      view(<Limits limits={worst} now={NOW} />);
      view(<LimitsSummaryStrip limits={worst} onOpenLimits={() => {}} now={NOW} />);
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([]);
  });

  test("the strip lists every plan and prints no NaN", () => {
    const html = view(<LimitsSummaryStrip limits={worst} onOpenLimits={() => {}} now={NOW} />);
    expect((html.match(/<button[^>]*limits-row/g) ?? []).length).toBe(12);
    expect(html).not.toContain("more plan");
    expect(html).not.toContain("NaN");
  });
});

describe("LimitsSummaryStrip", () => {
  test("is a Quota heading, an All limits link and one tile per plan", () => {
    const html = view(<LimitsSummaryStrip limits={sampleLimits} onOpenLimits={() => {}} now={NOW} />);
    expect(html).toContain("<strong>Quota</strong>");
    expect(html).toContain("All limits");
    expect(html).toContain("Claude Code");
    expect(html).toContain("OpenCode Go");
    expect(html).toContain("Limit reached: </span>0% left");
    expect(html).toContain("Resets in 4h");
    expect(html).not.toContain("Remaining quota");
    expect(html).not.toContain("most urgent first");
    expect(html).not.toContain("5-hour session");
  });

  test("lists the most urgent plan first", () => {
    const html = view(<LimitsSummaryStrip limits={{ ...sampleLimits, items: [...sampleLimits.items].reverse() }} onOpenLimits={() => {}} now={NOW} />);
    expect(html.indexOf("Claude Code")).toBeLessThan(html.indexOf("OpenCode Go"));
  });

  test("shows an Unavailable tile for error-only cards instead of dropping them", () => {
    const html = view(
      <LimitsSummaryStrip
        limits={payload([
          card({ id: "ok", name: "Healthy" }),
          card({ id: "bad", name: "Expired Tool", windows: [], error: "Sign-in expired. Run /login again." }),
          card({ id: "none", name: "Silent Tool", windows: [] }),
        ])}
        onOpenLimits={() => {}}
        now={NOW}
      />,
    );
    expect(html).toContain("Expired Tool");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Sign-in expired. Run /login again.");
    expect(html).toContain("Silent Tool");
    expect(html).toContain("No data");
    expect(html.indexOf("Expired Tool")).toBeLessThan(html.indexOf("Healthy"));
  });

  test("a plan with no reset time falls back to the dollar remaining", () => {
    const html = view(
      <LimitsSummaryStrip
        limits={payload([card({ windows: [win({ resetsAt: null, remainingValueText: "$58.02 left" })] })])}
        onOpenLimits={() => {}}
        now={NOW}
      />,
    );
    expect(html).toContain("$58.02 left");
  });

  test("a stale plan says so and its tile is dimmed", () => {
    const html = view(
      <LimitsSummaryStrip
        limits={payload([card({ stale: true, staleSince: "2026-10-14T02:48:00Z" })])}
        onOpenLimits={() => {}}
        now={NOW}
      />,
    );
    expect(html).toContain("Stale · 12m ago");
    expect(html).toContain("is-stale");
  });

  test("renders nothing without cards", () => {
    expect(view(<LimitsSummaryStrip limits={payload([])} onOpenLimits={() => {}} />)).toBe("");
    expect(view(<LimitsSummaryStrip limits={null} onOpenLimits={() => {}} />)).toBe("");
  });
});
