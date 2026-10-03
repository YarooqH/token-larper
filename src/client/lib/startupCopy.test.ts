import { expect, test } from "bun:test";
import { startupCopy } from "./startupCopy.ts";

test("Windows keeps its current wording", () => {
  const off = startupCopy({ platform: "windows", enabled: false, disabledBySystem: false });
  expect(off).toEqual({
    toggleLabel: "Start with Windows",
    status: "Manual launch",
    toggleHint: "Launch Token Larper when you sign in.",
    toggleDisabled: false,
    browserHint: "Takes effect when Start with Windows is on.",
    entryLabel: "Windows startup",
  });
  expect(startupCopy({ platform: "windows", enabled: true, disabledBySystem: false }).status).toBe("Starts with Windows");
  expect(startupCopy({ platform: "windows", enabled: true, disabledBySystem: false }).browserHint).toBe("Open the dashboard in your browser after launch.");
});

test("macOS and Linux say 'at login'", () => {
  for (const platform of ["macos", "linux"] as const) {
    const on = startupCopy({ platform, enabled: true, disabledBySystem: false });
    expect(on.toggleLabel).toBe("Start at login");
    expect(on.status).toBe("Starts at login");
    expect(startupCopy({ platform, enabled: false, disabledBySystem: false }).browserHint).toBe("Takes effect when Start at login is on.");
  }
  expect(startupCopy({ platform: "macos", enabled: false, disabledBySystem: false }).entryLabel).toBe("Login item");
  expect(startupCopy({ platform: "linux", enabled: false, disabledBySystem: false }).entryLabel).toBe("Autostart entry");
});

test("turned off in macOS System Settings: explain, and leave the switch to System Settings", () => {
  const copy = startupCopy({ platform: "macos", enabled: false, disabledBySystem: true });
  expect(copy.status).toBe("Turned off in System Settings");
  expect(copy.toggleHint).toBe("Turn Token Larper back on in System Settings → General → Login Items.");
  expect(copy.toggleDisabled).toBe(true);
});

test("turned off by the Linux desktop: explain, and the switch turns it back on", () => {
  const copy = startupCopy({ platform: "linux", enabled: false, disabledBySystem: true });
  expect(copy.status).toBe("Turned off in your desktop's startup settings");
  expect(copy.toggleHint).toBe("Your desktop's startup settings turned it off. Switch it on here to start it at login again.");
  expect(copy.toggleDisabled).toBe(false);
});
