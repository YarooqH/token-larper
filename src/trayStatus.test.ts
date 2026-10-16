import { describe, expect, test } from "bun:test";
import { trayDashboardData } from "./trayStatus.ts";
import type { DashboardPayload } from "./types.ts";

const payload = (generatedAt: string) => ({ generatedAt }) as DashboardPayload;
const NOW = Date.parse("2026-10-16T00:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("trayDashboardData", () => {
  test("serves a snapshot under a minute old without rescanning", async () => {
    let rescans = 0;
    const fresh = payload(ago(10_000));
    const data = await trayDashboardData(async () => fresh, async () => (rescans++, payload(ago(0))), NOW);
    expect(data).toBe(fresh);
    expect(rescans).toBe(0);
  });

  test("rescans a stale snapshot and returns the new one", async () => {
    const stale = payload(ago(6 * 3600_000));
    const updated = payload(ago(0));
    const data = await trayDashboardData(async () => stale, async () => updated, NOW);
    expect(data).toBe(updated);
  });

  test("falls back to the snapshot when the rescan fails", async () => {
    const stale = payload(ago(6 * 3600_000));
    const data = await trayDashboardData(async () => stale, () => Promise.reject(new Error("ccusage failed")), NOW);
    expect(data).toBe(stale);
  });

  test("does not hold the tray up for a rescan that is still running", async () => {
    const stale = payload(ago(6 * 3600_000));
    const started = Date.now();
    const data = await trayDashboardData(async () => stale, () => new Promise<DashboardPayload>(() => {}), NOW);
    expect(data).toBe(stale);
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});
