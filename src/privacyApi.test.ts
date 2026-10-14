import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "./settings.ts";
import { updatePrivacy } from "./privacyApi.ts";

describe("POST /api/privacy", () => {
  const dir = mkdtempSync(join(tmpdir(), "token-larper-privacy-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  const make = (locked = false) => createSettings({ file: join(dir, `s-${n++}.json`), envOffline: () => (locked ? "1" : undefined) });

  test("turns offline mode on and off and answers with the new status", () => {
    const settings = make();
    expect(updatePrivacy(settings, { offline: true })).toEqual({ status: 200, body: { offline: true, locked: false } });
    expect(settings.isOffline()).toBe(true);
    expect(updatePrivacy(settings, { offline: false })).toEqual({ status: 200, body: { offline: false, locked: false } });
    expect(settings.isOffline()).toBe(false);
  });

  test("refuses anything that is not { offline: boolean }", () => {
    const settings = make();
    for (const body of [null, undefined, "yes", 1, [], {}, { offline: "true" }, { offline: 1 }]) {
      expect(updatePrivacy(settings, body).status).toBe(400);
    }
    expect(settings.isOffline()).toBe(false);
  });

  test("won't turn off an offline mode that TOKEN_LARPER_OFFLINE forces on", () => {
    const settings = make(true);
    const reply = updatePrivacy(settings, { offline: false });
    expect(reply.status).toBe(409);
    expect(JSON.stringify(reply.body)).toContain("TOKEN_LARPER_OFFLINE");
    expect(settings.isOffline()).toBe(true);
  });

  test("accepts turning it on when it is already forced on", () => {
    expect(updatePrivacy(make(true), { offline: true }).status).toBe(200);
  });
});
