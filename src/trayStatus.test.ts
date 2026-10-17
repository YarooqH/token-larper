import { describe, expect, test } from "bun:test";
import { trayDashboardData } from "./trayStatus.ts";
import type { DashboardPayload } from "./types.ts";

const payload = (generatedAt: string) => ({ generatedAt }) as DashboardPayload;
const NOW = Date.parse("2026-10-16T00:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const STALE = ago(6 * 3600_000);

describe("trayDashboardData", () => {
  test("serves a fresh snapshot without rescanning", async () => {
    let rescans = 0;
    const fresh = payload(ago(10_000));
    const result = await trayDashboardData(async () => fresh, async () => (rescans++, payload(ago(0))), { popup: true, now: NOW });
    expect(result).toEqual({ data: fresh, refreshing: false });
    expect(rescans).toBe(0);
  });

  test("lets a poll use a snapshot that only the popup would call old", async () => {
    let rescans = 0;
    const aMinuteOld = payload(ago(2 * 60_000));
    const poll = await trayDashboardData(async () => aMinuteOld, async () => (rescans++, payload(ago(0))), { now: NOW });
    expect(poll.refreshing).toBe(false);
    expect(rescans).toBe(0);
    const popup = await trayDashboardData(async () => aMinuteOld, async () => (rescans++, payload(ago(0))), { popup: true, now: NOW });
    expect(popup.refreshing).toBe(false);
    expect(rescans).toBe(1);
  });

  test("the popup waits for a rescan of a stale snapshot and returns the new one", async () => {
    const updated = payload(ago(0));
    const result = await trayDashboardData(async () => payload(STALE), async () => updated, { popup: true, now: NOW });
    expect(result).toEqual({ data: updated, refreshing: false });
  });

  test("a poll starts the rescan but answers with what it has", async () => {
    let rescans = 0;
    const stale = payload(STALE);
    const result = await trayDashboardData(async () => stale, async () => (rescans++, payload(ago(0))), { now: NOW });
    expect(result).toEqual({ data: stale, refreshing: true });
    expect(rescans).toBe(1);
  });

  test("falls back to the snapshot when the rescan fails", async () => {
    const stale = payload(STALE);
    const result = await trayDashboardData(async () => stale, () => Promise.reject(new Error("ccusage failed")), { popup: true, now: NOW });
    expect(result.data).toBe(stale);
  });

  test("does not hold the popup up for a rescan that is still running", async () => {
    const stale = payload(STALE);
    const started = Date.now();
    const result = await trayDashboardData(async () => stale, () => new Promise<DashboardPayload>(() => {}), { popup: true, now: NOW });
    expect(result).toEqual({ data: stale, refreshing: true });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
