import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "./settings.ts";
import { checkForUpdates } from "./updates.ts";

describe("offline setting", () => {
  const dir = mkdtempSync(join(tmpdir(), "token-larper-settings-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  const file = () => join(dir, `settings-${n++}.json`);
  const noEnv = () => undefined;

  test("is off until chosen", () => {
    expect(createSettings({ file: file(), envOffline: noEnv }).status()).toEqual({ offline: false, locked: false });
  });

  test("is saved, and a later start reads it back", () => {
    const path = file();
    expect(createSettings({ file: path, envOffline: noEnv }).setOffline(true)).toEqual({ offline: true, locked: false });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ offline: true });
    expect(createSettings({ file: path, envOffline: noEnv }).isOffline()).toBe(true);

    const again = createSettings({ file: path, envOffline: noEnv });
    expect(again.setOffline(false).offline).toBe(false);
    expect(createSettings({ file: path, envOffline: noEnv }).isOffline()).toBe(false);
  });

  test("TOKEN_LARPER_OFFLINE=1 forces it on and marks it locked, whatever was saved", () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ offline: false }));
    const settings = createSettings({ file: path, envOffline: () => "1" });
    expect(settings.status()).toEqual({ offline: true, locked: true });
    // The saved choice is still recorded, for when the variable is gone.
    settings.setOffline(false);
    expect(settings.status()).toEqual({ offline: true, locked: true });
    expect(createSettings({ file: path, envOffline: noEnv }).isOffline()).toBe(false);
  });

  test("other values of the variable don't count", () => {
    expect(createSettings({ file: file(), envOffline: () => "0" }).status().locked).toBe(false);
    expect(createSettings({ file: file(), envOffline: () => "true" }).status().locked).toBe(false);
  });

  test("a missing or damaged file means online", () => {
    const path = file();
    writeFileSync(path, "{not json");
    expect(createSettings({ file: path, envOffline: noEnv }).isOffline()).toBe(false);
    writeFileSync(path, JSON.stringify({ offline: "yes" }));
    expect(createSettings({ file: path, envOffline: noEnv }).isOffline()).toBe(false);
  });

  test("keeps the choice for this run when the file can't be written", () => {
    const settings = createSettings({ file: join(dir, "missing", "\0bad", "settings.json"), envOffline: noEnv });
    expect(settings.setOffline(true).offline).toBe(true);
    expect(settings.isOffline()).toBe(true);
  });
});

describe("update check", () => {
  test("offline mode answers from what is known without asking npm", async () => {
    const status = await checkForUpdates(true, true);
    expect(status.error).toBeUndefined();
    expect(status.current).toBeString();
  });
});
