import { expect, test } from "bun:test";
import { assertPermanentInstall, bootTarget, displayCommand, isTemporaryInstall, samePath } from "./backend.ts";

test("bootTarget returns cli.js only for '<bun> <cli.js> --boot'", () => {
  expect(bootTarget(["/u/bun", "/app/bin/cli.js", "--boot"])).toBe("/app/bin/cli.js");
  expect(bootTarget(["/u/bun", "/app/bin/cli.js"])).toBeNull();
  expect(bootTarget(["/u/bun", "/app/bin/cli.js", "--foreground"])).toBeNull();
  expect(bootTarget(null)).toBeNull();
});

test("displayCommand quotes arguments with spaces or quotes", () => {
  expect(displayCommand(["/u/bun", "/My Apps/cli.js", "--boot"])).toBe('/u/bun "/My Apps/cli.js" --boot');
  expect(displayCommand(['/a"b'])).toBe('"/a\\"b"');
});

test("samePath ignores case on Windows only", () => {
  expect(samePath("C:\\App\\x.vbs", "c:\\app\\X.VBS", "windows")).toBe(true);
  expect(samePath("/App/cli.js", "/app/cli.js", "linux")).toBe(false);
  expect(samePath("/app/cli.js", "/app/cli.js", "macos")).toBe(true);
});

test("isTemporaryInstall spots a bunx copy in the OS temp folder", () => {
  expect(isTemporaryInstall("/tmp/bunx-1000-token-larper@1.12.0/node_modules/token-larper", "/tmp")).toBe(true);
  expect(
    isTemporaryInstall("/private/var/folders/ab/xyz/T/bunx-501-token-larper@1.12.0/node_modules/token-larper", "/private/var/folders/ab/xyz/T"),
  ).toBe(true);
  expect(
    isTemporaryInstall(
      String.raw`C:\Users\q\AppData\Local\Temp\bunx-1-token-larper@1.12.0\node_modules\token-larper`,
      String.raw`C:\Users\q\AppData\Local\Temp`,
    ),
  ).toBe(true);
});

test("isTemporaryInstall flags a bunx- folder even outside the temp folder", () => {
  expect(isTemporaryInstall("/var/cache/bunx-7-token-larper@1.12.0/node_modules/token-larper", "/tmp")).toBe(true);
});

test("isTemporaryInstall accepts permanent installs", () => {
  expect(isTemporaryInstall("/home/sam/.bun/install/global/node_modules/token-larper", "/tmp")).toBe(false);
  expect(isTemporaryInstall("/tmpfoo/app", "/tmp")).toBe(false);
});

test("assertPermanentInstall refuses a temporary bunx copy with the install instructions", () => {
  expect(() => assertPermanentInstall("/tmp/bunx-1000-token-larper@1.12.0/node_modules/token-larper", "/tmp")).toThrow(
    new Error(
      `Start at login needs a permanent install. This copy runs from a temporary bunx folder that your system clears, so it wouldn't start after a restart. Install it with "bun add -g token-larper", start it with "token-larper", then turn this on again.`,
    ),
  );
  expect(() => assertPermanentInstall("/home/sam/.bun/install/global/node_modules/token-larper", "/tmp")).not.toThrow();
});
