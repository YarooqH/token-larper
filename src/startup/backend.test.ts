import { expect, test } from "bun:test";
import { bootTarget, displayCommand, samePath } from "./backend.ts";

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
