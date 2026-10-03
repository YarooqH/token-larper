import { describe, expect, test } from "bun:test";
import type { PricingStatus } from "../../types.ts";
import { formatRate, statusLine, timeAgo } from "./prices.ts";

describe("formatRate", () => {
  test("shows whole and cent prices to the cent", () => {
    expect(formatRate(4)).toBe("$4.00");
    expect(formatRate(20)).toBe("$20.00");
    expect(formatRate(0.2)).toBe("$0.20");
    expect(formatRate(18.75)).toBe("$18.75");
  });

  test("keeps the digits of fractional-cent prices instead of rounding them", () => {
    // OpenRouter lists these exactly; $0.125 must not become $0.13.
    expect(formatRate(0.125)).toBe("$0.125");
    expect(formatRate(0.0375)).toBe("$0.0375");
    expect(formatRate(0.06)).toBe("$0.06");
    expect(formatRate(0.01)).toBe("$0.01");
  });

  test("rounds long repeating decimals to four significant digits", () => {
    // OpenRouter lists a $0.0416666... cache price; six decimals of it is noise.
    expect(formatRate(0.041666666)).toBe("$0.04167");
    expect(formatRate(0.02565)).toBe("$0.02565");
    expect(formatRate(0.0036)).toBe("$0.0036");
    expect(formatRate(0.435)).toBe("$0.435");
  });

  test("shows a free price as $0", () => {
    expect(formatRate(0)).toBe("$0");
  });
});

describe("timeAgo", () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  test("counts minutes, hours and days", () => {
    expect(timeAgo(ago(20_000), now)).toBe("just now");
    expect(timeAgo(ago(5 * MIN), now)).toBe("5 min ago");
    expect(timeAgo(ago(2 * HOUR), now)).toBe("2 h ago");
    expect(timeAgo(ago(24 * HOUR), now)).toBe("1 day ago");
    expect(timeAgo(ago(72 * HOUR), now)).toBe("3 days ago");
  });
});

describe("statusLine", () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  const fetchedAt = new Date(now - 2 * 60 * 60_000).toISOString();
  const status = (over: Partial<PricingStatus> = {}): PricingStatus => ({
    fetchedAt,
    models: 346,
    lastDownloadFailed: false,
    offline: false,
    ...over,
  });

  test("reports the list's size and age", () => {
    expect(statusLine(status(), now)).toBe("From OpenRouter's price list (346 models, updated 2 h ago).");
  });

  test("says when it is using a saved copy because downloads are off", () => {
    expect(statusLine(status({ offline: true }), now)).toBe(
      "From the saved copy of OpenRouter's price list (346 models, updated 2 h ago). Downloads are off.",
    );
  });

  test("says when the latest download failed", () => {
    expect(statusLine(status({ lastDownloadFailed: true }), now)).toBe(
      "From the saved copy of OpenRouter's price list (346 models, updated 2 h ago). The latest download failed and will be retried.",
    );
  });

  test("says when no list has loaded yet", () => {
    expect(statusLine(status({ fetchedAt: null }), now)).toBe(
      "OpenRouter's price list hasn't downloaded yet, so only Anthropic's rates for Claude are known.",
    );
    expect(statusLine(undefined, now)).toBe(
      "OpenRouter's price list hasn't downloaded yet, so only Anthropic's rates for Claude are known.",
    );
    expect(statusLine(status({ fetchedAt: null, offline: true }), now)).toBe(
      "Offline, and no OpenRouter price list has been saved yet, so only Anthropic's rates for Claude are known.",
    );
  });
});
