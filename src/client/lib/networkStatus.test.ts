import { describe, expect, test } from "bun:test";
import { priceListLine, updateCheckLine } from "./networkStatus.ts";
import type { PricingStatus } from "../../types.ts";

const NOW = Date.UTC(2026, 9, 13, 12);
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const prices = (over: Partial<PricingStatus> = {}): PricingStatus => ({ fetchedAt: ago(6), models: 300, lastDownloadFailed: false, offline: false, ...over });

describe("update check line", () => {
  test("says when it last ran", () => {
    expect(updateCheckLine({ offline: false, autoCheck: true, checkedAt: ago(2) }, NOW)).toBe("Checked 2 h ago");
  });
  test("is paused offline, whatever happened before", () => {
    expect(updateCheckLine({ offline: true, autoCheck: true, checkedAt: ago(2) }, NOW)).toBe("Paused");
  });
  test("tells apart never-run and switched off", () => {
    expect(updateCheckLine({ offline: false, autoCheck: true, checkedAt: null }, NOW)).toBe("Not yet");
    expect(updateCheckLine({ offline: false, autoCheck: false, checkedAt: undefined }, NOW)).toBe("Off");
  });
});

describe("price list line", () => {
  test("says how old the list is", () => {
    expect(priceListLine({ offline: false, status: prices() }, NOW)).toBe("Updated 6 h ago");
  });
  test("mentions a failed download that will be retried", () => {
    expect(priceListLine({ offline: false, status: prices({ lastDownloadFailed: true }) }, NOW)).toBe("Updated 6 h ago · retrying");
  });
  test("offline keeps using the saved copy and says so", () => {
    expect(priceListLine({ offline: true, status: prices({ offline: true }) }, NOW)).toBe("Paused · saved 6 h ago");
    expect(priceListLine({ offline: true, status: prices({ fetchedAt: null }) }, NOW)).toBe("Paused");
  });
  test("reports a list that hasn't loaded", () => {
    expect(priceListLine({ offline: false, status: prices({ fetchedAt: null }) }, NOW)).toBe("Not downloaded yet");
    expect(priceListLine({ offline: false, status: undefined }, NOW)).toBe("Not downloaded yet");
  });
});
