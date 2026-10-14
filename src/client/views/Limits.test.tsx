import { describe, expect, test } from "bun:test";
import React from "react";
import type { HarnessLimitCard, LimitsPayload, QuotaWindow } from "../../types.ts";
import { render } from "../testing/dashboard.tsx";
import {
  cardNeedsAttention,
  clampPercent,
  computeWindowTimeRemainingPercent,
  formatAge,
  formatPercent,
  formatResetCountdown,
  Limits,
  LimitsSummaryStrip,
  pickHeadlineCredit,
  pickPrimaryWindow,
  sortCards,
  sortWindows,
  windowPercents,
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
      planName: "Claude Pro",
      source: "live",
      sourceLabel: "Anthropic OAuth",
      updatedAt: "2026-10-14T03:00:00Z",
      windows: [
        {
          id: "five_hour",
          label: "5-hour session",
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
      planName: "OpenCode Go ($10/mo)",
      source: "local",
      sourceLabel: "Local rolling ledger",
      updatedAt: "2026-10-14T03:00:00Z",
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
  });

  test("computeWindowTimeRemainingPercent computes linear window pace", () => {
    // 2.5 hours left out of a 5-hour (18000s) window = 50%
    const pct = computeWindowTimeRemainingPercent({ resetsAt: "2026-10-14T05:30:00Z", windowSeconds: 18000 }, NOW);
    expect(pct).toBe(50);
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

  test("sortCards orders attention first, then live before local, then by name", () => {
    const sorted = sortCards([
      card({ id: "local-a", name: "Alpha", source: "local" }),
      card({ id: "live-z", name: "Zed", source: "live" }),
      card({ id: "live-b", name: "beta", source: "live" }),
      card({ id: "warn", name: "Warned", source: "local", windows: [win({ status: "warning", remainingPercent: 15 })] }),
      card({ id: "err", name: "Broken", source: "live", windows: [], error: "expired" }),
      card({ id: "crit", name: "Critical", source: "local", windows: [win({ status: "critical", remainingPercent: 0 })] }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["crit", "err", "warn", "live-b", "live-z", "local-a"]);
  });

  test("cardNeedsAttention covers flagged windows and unreadable providers", () => {
    expect(cardNeedsAttention(card())).toBe(false);
    expect(cardNeedsAttention(card({ windows: [win({ status: "warning" })] }))).toBe(true);
    expect(cardNeedsAttention(card({ windows: [], error: "no token" }))).toBe(true);
    expect(cardNeedsAttention(card({ windows: [] }))).toBe(false);
  });

  test("pickHeadlineCredit prefers the bucket expiring soonest", () => {
    const entries = [
      { credit: { label: "A", remainingText: "$5", resetsAt: "2026-12-01T00:00:00Z" } },
      { credit: { label: "B", remainingText: "$9", resetsAt: "2026-10-20T00:00:00Z" } },
      { credit: { label: "C", remainingText: "$1", resetsAt: null } },
    ];
    expect(pickHeadlineCredit(entries, NOW)?.credit.label).toBe("B");
    expect(pickHeadlineCredit([entries[2]!], NOW)?.credit.label).toBe("C");
    expect(pickHeadlineCredit([], NOW)).toBeNull();
  });
});

describe("Limits view", () => {
  test("renders KPI summary, subscription cards, windows, credits, and breakdowns", () => {
    const html = view(<Limits limits={sampleLimits} now={NOW} />);
    expect(html).toContain("Connected plans");
    expect(html).toContain("1 live · 1 local");
    expect(html).toContain("Claude Pro");
    expect(html).toContain("OpenCode Go ($10/mo)");
    expect(html).toContain("5-hour session");
    expect(html).toContain("0% left");
    expect(html).toContain("44% left");
    expect(html).toContain("97% left");
    expect(html).toContain("$58.02 left");
    expect(html).toContain("$100.00 left");
    expect(html).toContain("7-day usage by surface");
  });

  test("does not apply the global tool filter, since the picker is hidden on this view", () => {
    const html = view(<Limits limits={sampleLimits} now={NOW} />, { harness: "claude" });
    expect(html).toContain("Claude Pro");
    expect(html).toContain("OpenCode Go ($10/mo)");
  });

  test("windows render shortest first and expose progressbar text with the reset time", () => {
    const html = view(<Limits limits={sampleLimits} now={NOW} />);
    expect(html.indexOf("5-hour session")).toBeLessThan(html.indexOf("7-day weekly"));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuetext="44% left, resets in 4d 20h');
    expect(html).toContain("Limit reached");
    expect(html).toContain("Resets in <strong>4d 20h</strong>");
  });

  test("a stale card shows the stale badge instead of Live, keeps its countdowns, and dims via is-stale", () => {
    const stale = card({
      id: "stale",
      name: "Stale Tool",
      stale: true,
      staleSince: "2026-10-14T02:48:00Z",
      windows: [win({ resetsAt: "2026-10-14T05:00:00Z" })],
    });
    const html = view(<Limits limits={payload([stale])} now={NOW} />);
    expect(html).toContain("Stale · last updated 12m ago");
    expect(html).toContain("limit-card is-stale");
    expect(html).not.toContain("limit-source-pill is-live");
    expect(html).toContain("Resets in <strong>2h</strong>");
  });

  test("a stale card without a usable staleSince still says it is stale", () => {
    const html = view(<Limits limits={payload([card({ stale: true, staleSince: "garbage" })])} now={NOW} />);
    expect(html).toContain("Stale · last update time unknown");
  });

  test("an error-only card shows the message and a hint instead of an empty card", () => {
    const broken = card({ id: "broken", name: "Claude Code", windows: [], error: "Sign-in expired (401)" });
    const html = view(<Limits limits={payload([broken])} now={NOW} />);
    expect(html).toContain("Couldn't read this quota");
    expect(html).toContain("Sign-in expired (401)");
    expect(html).toContain("Check that Claude Code is signed in on this machine, then refresh.");
    expect(html).toContain("Unavailable");
    expect(html).toContain("1 unavailable");
    expect(html).toContain("No quota windows reported");
  });

  test("a card with neither windows nor an error says there is nothing yet", () => {
    const html = view(<Limits limits={payload([card({ windows: [] })])} now={NOW} />);
    expect(html).toContain("No quota windows reported yet.");
    expect(html).not.toContain("Couldn't read this quota");
  });

  test("a card note shows in the footer", () => {
    const noted = card({ source: "local", note: "Estimated from local logs against list caps" });
    const html = view(<Limits limits={payload([noted])} now={NOW} />);
    expect(html).toContain("limit-card-foot");
    expect(html).toContain("Estimated from local logs against list caps");
  });

  test("an error on a card that still has windows is shown as a failed refresh in the footer", () => {
    const html = view(<Limits limits={payload([card({ error: "timeout" })])} now={NOW} />);
    expect(html).toContain("Last refresh failed: timeout");
    expect(html).not.toContain("Couldn't read this quota");
  });

  test("Checked time flags an old payload and stays plain for a fresh one", () => {
    const fresh = view(<Limits limits={payload([card()])} now={NOW} />);
    expect(fresh).toContain("Checked");
    expect(fresh).not.toContain("may be out of date");
    const old = view(<Limits limits={payload([card()], "2026-10-14T02:40:00Z")} now={NOW} />);
    expect(old).toContain("20m ago, may be out of date");
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

  test("extra credits tile shows the soonest-expiring bucket with its owner, label and a count", () => {
    const html = view(
      <Limits
        limits={payload([
          card({ id: "a", name: "Alpha", credits: [{ label: "Bonus", remainingText: "$5.00 left", resetsAt: "2026-12-01T00:00:00Z" }] }),
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
    expect(html).toContain("Extra credits");
    expect(html).toContain('<div class="kpi-value is-compact">$9.00 left</div>');
    expect(html).toContain("Beta · Promo · +2 more");
  });

  test("extra credits tile is empty-safe", () => {
    const html = view(<Limits limits={payload([card()])} now={NOW} />);
    expect(html).toContain("No promotional or bonus credit buckets");
  });

  test("KPIs stay safe when every card has zero windows", () => {
    const html = view(<Limits limits={payload([card({ windows: [], error: "x" }), card({ id: "d", windows: [] })])} now={NOW} />);
    expect(html).toContain("No quota windows reported");
    expect(html).toContain("No active cooldowns");
    expect(html).toContain("2 live · 0 local · 1 unavailable");
  });

  test("an empty payload explains what is detected and that credentials stay local", () => {
    const html = view(<Limits limits={payload([])} now={NOW} onRefresh={() => {}} />);
    expect(html).toContain("No quota sources detected");
    for (const name of ["Claude Code", "Codex", "Antigravity", "Copilot", "OpenCode Go"]) expect(html).toContain(name);
    expect(html).toContain("Credentials are only read locally");
    expect(html).toContain("Check again");
  });

  test("loading shows a skeleton with an accessible status, and a failed first load shows an error with retry", () => {
    const loading = view(<Limits limits={null} />);
    expect(loading).toContain("skel");
    expect(loading).toContain("Checking subscription quotas");
    const failed = view(<Limits limits={null} error="HTTP 500" onRefresh={() => {}} />);
    expect(failed).toContain("Couldn't load quotas");
    expect(failed).toContain("HTTP 500");
    expect(failed).toContain("Try again");
  });

  test("a failed refresh over existing data keeps the cards and says so", () => {
    const html = view(<Limits limits={sampleLimits} error="HTTP 502" now={NOW} />);
    expect(html).toContain("Couldn't refresh quotas (HTTP 502). Showing the last result.");
    expect(html).toContain("Claude Pro");
  });

  test("the pace marker has a visible legend and is hidden from assistive tech", () => {
    const html = view(<Limits limits={sampleLimits} now={NOW} />);
    expect(html).toContain("The tick on a bar marks where an even pace");
    expect(html).toContain('class="limit-bar-pace"');
    expect(html).toContain('aria-hidden="true"');
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
    expect(html).toContain("Reset time not reported");
    expect(html).toContain("100% left");
    expect(html).toContain("0% left");
  });

  test("worst-case ids do not collide in React keys", () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      view(<Limits limits={worst} now={NOW} />);
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([]);
  });

  test("the strip shows at most six plans and points at the rest", () => {
    const html = view(<LimitsSummaryStrip limits={worst} onOpenLimits={() => {}} now={NOW} />);
    expect((html.match(/limits-mini-card/g) ?? []).length).toBe(7);
    expect(html).toContain("+3 more plans");
    expect(html).toContain("9 plans");
    expect(html).not.toContain("NaN");
  });
});

describe("LimitsSummaryStrip", () => {
  test("renders compact overview tiles for each subscription", () => {
    const html = view(<LimitsSummaryStrip limits={sampleLimits} onOpenLimits={() => {}} now={NOW} />);
    expect(html).toContain("Remaining quota");
    expect(html).toContain("Claude Code");
    expect(html).toContain("OpenCode Go");
    expect(html).toContain("All limits");
    expect(html).toContain("Limit reached: </span>0% left");
    expect(html).toContain("Resets in 4h");
  });

  test("lists the most urgent plan first", () => {
    const html = view(<LimitsSummaryStrip limits={{ ...sampleLimits, items: [...sampleLimits.items].reverse() }} onOpenLimits={() => {}} now={NOW} />);
    expect(html.indexOf("Claude Code")).toBeLessThan(html.indexOf("OpenCode Go"));
  });

  test("shows a Needs attention tile for error-only cards instead of dropping them", () => {
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
    expect(html).toContain("Needs attention");
    expect(html).toContain("Sign-in expired. Run /login again.");
    expect(html).toContain("Silent Tool");
    expect(html).toContain("No data");
    expect(html.indexOf("Expired Tool")).toBeLessThan(html.indexOf("Healthy"));
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
