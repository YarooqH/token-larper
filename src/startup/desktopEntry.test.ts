import { expect, test } from "bun:test";
import { autostartDir, buildDesktopEntry, parseDesktopEntry, splitExec } from "./desktopEntry.ts";

const paths = { bun: "/home/sam/.bun/bin/bun", cliJs: "/home/sam/.bun/install/cache/token-larper@1.12.0/bin/cli.js" };

test("autostartDir honors an absolute XDG_CONFIG_HOME", () => {
  expect(autostartDir({}, "/home/sam")).toBe("/home/sam/.config/autostart");
  expect(autostartDir({ XDG_CONFIG_HOME: "/cfg" }, "/home/sam")).toBe("/cfg/autostart");
  expect(autostartDir({ XDG_CONFIG_HOME: "relative/cfg" }, "/home/sam")).toBe("/home/sam/.config/autostart");
});

test("the desktop entry has the keys the spec requires", () => {
  const text = buildDesktopEntry(paths);
  expect(text.startsWith("[Desktop Entry]\n")).toBe(true);
  for (const line of ["Type=Application", "Name=Token Larper", "Terminal=false", "X-GNOME-Autostart-enabled=true"]) {
    expect(text).toContain(`\n${line}\n`);
  }
  expect(text).toContain(`Exec="${paths.bun}" "${paths.cliJs}" --boot\n`);
  expect(text).not.toContain("NoDisplay");
});

test("a backslash and a percent sign are escaped on disk as four backslashes and %%", () => {
  const cliJs = "/home/sam/back\\slash/100%/cli.js";
  const text = buildDesktopEntry({ ...paths, cliJs });
  expect(text).toContain('Exec="/home/sam/.bun/bin/bun" "/home/sam/back\\\\\\\\slash/100%%/cli.js" --boot\n');
  expect(parseDesktopEntry(text).args).toEqual([paths.bun, cliJs, "--boot"]);
});

test("Exec arguments survive quoting and escaping", () => {
  for (const cliJs of ["/home/sam/My Apps/cli.js", '/home/sam/a"b/cli.js', "/home/sam/$HOME/`x`/cli.js", "/home/sam/back\\slash/cli.js", "/home/sam/100%/cli.js", "/home/sam/ünïcode/cli.js"]) {
    const parsed = parseDesktopEntry(buildDesktopEntry({ ...paths, cliJs }));
    expect(parsed.args).toEqual([paths.bun, cliJs, "--boot"]);
  }
});

test("paths with line breaks are refused", () => {
  expect(() => buildDesktopEntry({ ...paths, cliJs: "/home/sam/a\nb/cli.js" })).toThrow();
});

test("an entry turned off by the desktop reads as disabled", () => {
  const base = buildDesktopEntry(paths);
  expect(parseDesktopEntry(base).disabled).toBe(false);
  expect(parseDesktopEntry(base.replace("X-GNOME-Autostart-enabled=true", "X-GNOME-Autostart-enabled=false")).disabled).toBe(true);
  expect(parseDesktopEntry(`${base}Hidden=true\n`).disabled).toBe(true);
});

test("keys outside [Desktop Entry] are ignored", () => {
  const text = `[Desktop Entry]\nExec=/a/bun /a/cli.js --boot\n[Desktop Action x]\nHidden=true\nExec=/other\n`;
  expect(parseDesktopEntry(text)).toEqual({ args: ["/a/bun", "/a/cli.js", "--boot"], disabled: false });
});

test("splitExec handles unquoted and quoted arguments", () => {
  expect(splitExec('/a/bun "/b c/cli.js" --boot')).toEqual(["/a/bun", "/b c/cli.js", "--boot"]);
});
