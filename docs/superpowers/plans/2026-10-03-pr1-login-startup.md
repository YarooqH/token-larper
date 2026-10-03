# PR 1: Start-at-login on macOS and Linux — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Start at login" work on macOS (LaunchAgent) and Linux (XDG autostart) the way "Start with Windows" works today, show the right wording per platform in Settings, and make version comparison follow semver prerelease rules.

**Architecture:** `src/startup.ts` keeps its three exported functions and delegates to one backend per OS (`src/startup/windows.ts`, `macos.ts`, `linux.ts`) behind a small `StartupBackend` interface. Building and parsing the plist and `.desktop` text lives in pure modules (`launchAgent.ts`, `desktopEntry.ts`) so it is unit-tested on any OS. The login entry on macOS and Linux runs `<bun> <bin/cli.js> --boot`, a new CLI mode that reads `settings.json` at login the way `scripts/run-server.ps1` does on Windows.

**Tech Stack:** Bun 1.1+, TypeScript (checked with `bunx tsc --noEmit -p .`), `bun:test`, React 19 for the Settings dialog, plain Node-compatible JS in `bin/cli.js`.

**Spec:** `docs/superpowers/specs/2026-10-03-macos-linux-tray-startup-design.md` (Part 1, plus the "Version comparison fix" in Part 4).

## Global Constraints

- Start-at-login is off by default and only created when the user turns it on. Updates never turn it on. The stale-entry repair only rewrites an entry that is already on, and never one the user turned off in the OS's own settings.
- Never bypass or hide an OS mechanism: no admin rights, sudo or root; never call `launchctl enable` to override a user's choice in System Settings; never suppress the macOS "Background Items Added" notice.
- No change to Windows behavior: the registry key `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value name `TokenLarper`, command `wscript.exe //B //Nologo "<app>\scripts\launch-silent.vbs"`, and the Windows Settings wording stay exactly as they are.
- macOS LaunchAgent: `~/Library/LaunchAgents/com.tokenlarper.agent.plist`, label `com.tokenlarper.agent`, `RunAtLoad` true, `AbandonProcessGroup` true, `LimitLoadToSessionType` `Aqua`, stdout and stderr to `login-agent.log` in the data folder.
- Linux autostart: `$XDG_CONFIG_HOME/autostart/token-larper.desktop`, default `~/.config/autostart/`; `X-GNOME-Autostart-enabled=true`, `NoDisplay=true`, `Terminal=false`.
- The login command stores absolute paths: `process.execPath` (Bun) and `<APP_ROOT>/bin/cli.js`, then `--boot`.
- Fail soft: if reading an entry fails, status still loads (as "not registered"); if writing fails, `/api/startup` returns 500 with the reason, which Settings already shows.
- Repo conventions: one branch per PR, bump `package.json` (minor for this PR), commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, PRs created with `C:/Program Files/GitHub CLI/gh.exe` using `--body-file`.
- The repo commits LF and checks out CRLF; read a file before editing it.
- CI runs `bunx tsc --noEmit -p .`, `bun test` and `bun run build`; all three must pass before the PR.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/semver.ts` | modify | `compareVersions` with semver prerelease precedence |
| `src/semver.test.ts` | modify | tests for the new ordering |
| `src/startup/backend.ts` | create | `StartupBackend` / `EntryState` types and small pure helpers (`NO_ENTRY`, `samePath`, `bootTarget`, `displayCommand`) |
| `src/startup/backend.test.ts` | create | tests for the helpers |
| `src/startup/launchAgent.ts` | create | pure: build the plist, read `ProgramArguments` back, read `launchctl print-disabled` output |
| `src/startup/launchAgent.test.ts` | create | tests |
| `src/startup/desktopEntry.ts` | create | pure: autostart folder, build the `.desktop` file, parse it back |
| `src/startup/desktopEntry.test.ts` | create | tests |
| `src/startup/repoint.ts` | create | pure: should a stale entry be rewritten? |
| `src/startup/repoint.test.ts` | create | tests |
| `src/startup/run.ts` | create | run a program and collect its output (`reg.exe`, `launchctl`) |
| `src/startup/windows.ts` | create | registry backend, moved from `src/startup.ts` |
| `src/startup/macos.ts` | create | LaunchAgent backend |
| `src/startup/linux.ts` | create | XDG autostart backend |
| `src/startup.ts` | modify | settings file plus delegation to the backend for the current OS |
| `src/types.ts` | modify | `StartupConfig` fields |
| `scripts/docs-demo-server.ts` | modify | sample `/api/startup` response with the new fields |
| `bin/cli.js` | modify | `--boot` mode |
| `src/client/lib/startupCopy.ts` | create | Settings wording per platform |
| `src/client/lib/startupCopy.test.ts` | create | tests |
| `src/client/components/SettingsDialog.tsx` | modify | use `startupCopy`, show `entry` / `entryPath` |
| `README.md` | modify | start-at-login on every OS, uninstall steps, headless `systemd --user` example |
| `docs/superpowers/specs/2026-10-03-macos-linux-tray-startup-design.md` | modify | drop `launchctl bootout` from the macOS disable step |
| `package.json` | modify | version bump |

---

### Task 0: Prepare the worktree

The branch `feat/login-startup-mac-linux` already exists in the worktree `F:\Just Some Files\opensource\tokenlarper-wt\login-startup`, branched from `origin/main`, with the spec committed.

- [ ] **Step 1: Install dependencies (new worktrees have no `node_modules`)**

Run in the worktree: `bun install --frozen-lockfile`
Expected: finishes without errors.

- [ ] **Step 2: Check the baseline is green**

Run: `bunx tsc --noEmit -p .` then `bun test`
Expected: both pass. If either fails before any change, stop and report it.

---

### Task 1: Semver prerelease ordering

**Files:**
- Modify: `src/semver.ts`
- Test: `src/semver.test.ts`

**Interfaces:**
- Produces: `compareVersions(a: string, b: string): number` returning -1, 0 or 1 by semver precedence. Callers stay the same: `src/updates.ts:31`, `src/server.ts:92`, `src/startup.ts` (repoint, moved to `src/startup/repoint.ts` in Task 4).

- [ ] **Step 1: Replace the test file with the new expectations**

`src/semver.test.ts`:

```ts
import { expect, test } from "bun:test";
import { compareVersions } from "./semver.ts";

test("compares versions numerically, not as text", () => {
  expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  expect(compareVersions("1.4.0", "1.5.0")).toBe(-1);
  expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  expect(compareVersions("0.0.0", "1.0.2")).toBe(-1);
});

test("a prerelease sorts before its release", () => {
  expect(compareVersions("1.5.0-beta.1", "1.5.0")).toBe(-1);
  expect(compareVersions("1.5.0", "1.5.0-beta.1")).toBe(1);
  expect(compareVersions("1.5.0-beta.1", "1.4.9")).toBe(1);
});

test("prerelease identifiers compare numerically when numeric", () => {
  expect(compareVersions("1.5.0-beta.2", "1.5.0-beta.10")).toBe(-1);
  expect(compareVersions("1.5.0-beta.1", "1.5.0-beta.1")).toBe(0);
  expect(compareVersions("1.5.0-alpha.1", "1.5.0-beta.1")).toBe(-1);
  expect(compareVersions("1.5.0-beta", "1.5.0-beta.1")).toBe(-1);
  expect(compareVersions("1.5.0-1", "1.5.0-beta")).toBe(-1);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `bun test src/semver.test.ts`
Expected: FAIL in "a prerelease sorts before its release" (today's code returns 0).

- [ ] **Step 3: Implement**

`src/semver.ts`:

```ts
/**
 * Compare versions by semver precedence: x.y.z numerically, then a prerelease
 * (1.5.0-beta.1) sorts before its release, and prerelease parts compare numerically
 * when both are numbers. Build metadata (+...) isn't used by this package.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): [string, string] => {
    const dash = v.indexOf("-");
    return dash < 0 ? [v, ""] : [v.slice(0, dash), v.slice(dash + 1)];
  };
  const [coreA, preA] = split(a);
  const [coreB, preB] = split(b);
  const parse = (v: string) => v.split(".").map((n) => Number(n) || 0);
  const [x, y] = [parse(coreA), parse(coreB)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  }
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  const [p, q] = [preA.split("."), preB.split(".")];
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    const [m, n] = [p[i], q[i]];
    if (m === undefined) return -1;
    if (n === undefined) return 1;
    if (m === n) continue;
    const [mNum, nNum] = [/^\d+$/.test(m), /^\d+$/.test(n)];
    if (mNum && nNum) return Number(m) > Number(n) ? 1 : -1;
    if (mNum) return -1;
    if (nNum) return 1;
    return m > n ? 1 : -1;
  }
  return 0;
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `bun test src/semver.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/semver.ts src/semver.test.ts
git commit -m "fix(updates): sort prerelease versions before their release

A tester on 1.13.0-beta.1 compared equal to 1.13.0, so the update
banner never offered the final release.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Backend types and the LaunchAgent and desktop-entry text

Pure code only: building and reading the macOS plist and the Linux `.desktop` file, plus the shared types. Nothing here touches the file system, so the tests run on Windows.

**Files:**
- Create: `src/startup/backend.ts`, `src/startup/launchAgent.ts`, `src/startup/desktopEntry.ts`
- Test: `src/startup/backend.test.ts`, `src/startup/launchAgent.test.ts`, `src/startup/desktopEntry.test.ts`

**Interfaces:**
- Produces (used by Tasks 3 and 4):
  - `type StartupPlatform = "windows" | "macos" | "linux"`
  - `interface EntryState { entry: string | null; target: string | null; disabledBySystem: boolean }`
  - `interface StartupBackend { platform; entryPath: string; launcherPath: string; assertCanEnable(): void; read(): Promise<EntryState>; write(): Promise<void>; remove(): Promise<void> }`
  - `NO_ENTRY: EntryState`, `samePath(a: string, b: string, platform: StartupPlatform): boolean`, `bootTarget(args: string[] | null): string | null`, `displayCommand(args: string[]): string`
  - `LAUNCH_AGENT_LABEL = "com.tokenlarper.agent"`, `buildPlist({ bun, cliJs, logFile }): string`, `parsePlistArgs(xml: string): string[] | null`, `isLabelDisabled(output: string, label?: string): boolean`
  - `DESKTOP_FILE_NAME = "token-larper.desktop"`, `autostartDir(env: { XDG_CONFIG_HOME?: string }, home: string): string`, `buildDesktopEntry({ bun, cliJs }): string`, `parseDesktopEntry(text: string): { args: string[] | null; disabled: boolean }`, `splitExec(value: string): string[]`

- [ ] **Step 1: Write the failing tests**

`src/startup/backend.test.ts`:

```ts
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
```

`src/startup/launchAgent.test.ts`:

```ts
import { expect, test } from "bun:test";
import { buildPlist, isLabelDisabled, LAUNCH_AGENT_LABEL, parsePlistArgs } from "./launchAgent.ts";

const paths = {
  bun: "/Users/sam/.bun/bin/bun",
  cliJs: "/Users/sam/.bun/install/cache/token-larper@1.12.0/bin/cli.js",
  logFile: "/Users/sam/Library/Application Support/TokenLarper/login-agent.log",
};

test("the plist has the label and the keys the spec requires", () => {
  const xml = buildPlist(paths);
  expect(xml).toContain(`<key>Label</key>\n  <string>${LAUNCH_AGENT_LABEL}</string>`);
  expect(xml).toContain("<key>RunAtLoad</key>\n  <true/>");
  expect(xml).toContain("<key>AbandonProcessGroup</key>\n  <true/>");
  expect(xml).toContain("<key>LimitLoadToSessionType</key>\n  <string>Aqua</string>");
  expect(xml).toContain(`<key>StandardOutPath</key>\n  <string>${paths.logFile}</string>`);
  expect(xml).toContain(`<key>StandardErrorPath</key>\n  <string>${paths.logFile}</string>`);
});

test("ProgramArguments read back exactly, including spaces and XML characters", () => {
  const tricky = { ...paths, cliJs: `/Users/sam/My <"App's"> & Stuff/bin/cli.js` };
  expect(parsePlistArgs(buildPlist(tricky))).toEqual([tricky.bun, tricky.cliJs, "--boot"]);
  expect(buildPlist(tricky)).not.toContain(`<"App's">`);
});

test("parsePlistArgs returns null without ProgramArguments", () => {
  expect(parsePlistArgs("<plist><dict><key>Label</key><string>x</string></dict></plist>")).toBeNull();
});

test("isLabelDisabled reads both launchctl output styles", () => {
  const newer = `disabled services = {\n\t"com.apple.x" => enabled\n\t"${LAUNCH_AGENT_LABEL}" => disabled\n}`;
  const older = `disabled services = {\n\t"${LAUNCH_AGENT_LABEL}" => true\n}`;
  const enabled = `disabled services = {\n\t"${LAUNCH_AGENT_LABEL}" => enabled\n}`;
  expect(isLabelDisabled(newer)).toBe(true);
  expect(isLabelDisabled(older)).toBe(true);
  expect(isLabelDisabled(enabled)).toBe(false);
  expect(isLabelDisabled(`"com.tokenlarper.agentX" => disabled`)).toBe(false);
});
```

`src/startup/desktopEntry.test.ts`:

```ts
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
  for (const line of ["Type=Application", "Name=Token Larper", "Terminal=false", "NoDisplay=true", "X-GNOME-Autostart-enabled=true"]) {
    expect(text).toContain(`\n${line}\n`);
  }
  expect(text).toContain(`Exec="${paths.bun}" "${paths.cliJs}" --boot\n`);
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
```

- [ ] **Step 2: Run them and see them fail**

Run: `bun test src/startup`
Expected: FAIL, modules `./backend.ts`, `./launchAgent.ts`, `./desktopEntry.ts` not found.

- [ ] **Step 3: Implement `src/startup/backend.ts`**

```ts
// Shared shape of the per-OS startup code (windows.ts, macos.ts, linux.ts).

export type StartupPlatform = "windows" | "macos" | "linux";

/** What the OS has registered to start Token Larper at login. */
export interface EntryState {
  /** The command the entry runs, for display; null when there is no entry. */
  entry: string | null;
  /** The launcher file it starts (scripts/launch-silent.vbs or bin/cli.js). */
  target: string | null;
  /** The entry exists, but the user turned it off in the OS's own settings. */
  disabledBySystem: boolean;
}

export interface StartupBackend {
  platform: StartupPlatform;
  /** Registry value, LaunchAgent plist or autostart .desktop file. */
  entryPath: string;
  /** This copy's launcher; an entry is this copy's when its target is this file. */
  launcherPath: string;
  /** Throws when this copy can't be started at login. */
  assertCanEnable(): void;
  read(): Promise<EntryState>;
  /** Create or overwrite the entry so it starts this copy. */
  write(): Promise<void>;
  remove(): Promise<void>;
}

export const NO_ENTRY: EntryState = { entry: null, target: null, disabledBySystem: false };

export function samePath(a: string, b: string, platform: StartupPlatform): boolean {
  return platform === "windows" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The cli.js a login command `<bun> <cli.js> --boot` starts, or null for anything else. */
export function bootTarget(args: string[] | null): string | null {
  return args && args.length === 3 && args[2] === "--boot" ? args[1]! : null;
}

export function displayCommand(args: string[]): string {
  return args.map((a) => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
}
```

- [ ] **Step 4: Implement `src/startup/launchAgent.ts`**

```ts
// The macOS LaunchAgent plist as text. Reading and writing the file is in macos.ts.

export const LAUNCH_AGENT_LABEL = "com.tokenlarper.agent";

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * Runs `<bun> <cli.js> --boot` once at login, in the GUI session (Aqua) so the menu bar
 * icon can appear. AbandonProcessGroup keeps launchd from stopping the server when the
 * launcher exits.
 */
export function buildPlist(o: { bun: string; cliJs: string; logFile: string }): string {
  const args = [o.bun, o.cliJs, "--boot"].map((a) => `    <string>${escapeXml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(o.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(o.logFile)}</string>
</dict>
</plist>
`;
}

export function parsePlistArgs(xml: string): string[] | null {
  const array = xml.match(/<key>\s*ProgramArguments\s*<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1];
  if (array === undefined) return null;
  return [...array.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescapeXml(m[1]!));
}

/**
 * Whether `launchctl print-disabled gui/<uid>` lists the label as turned off. Newer macOS
 * prints `"label" => disabled`, older versions `"label" => true`.
 */
export function isLabelDisabled(output: string, label = LAUNCH_AGENT_LABEL): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`"${escaped}"\\s*=>\\s*(true|disabled)\\b`).test(output);
}
```

- [ ] **Step 5: Implement `src/startup/desktopEntry.ts`**

```ts
import { posix } from "node:path";

// The Linux XDG autostart entry as text. Reading and writing the file is in linux.ts.

export const DESKTOP_FILE_NAME = "token-larper.desktop";

/** The XDG spec ignores a relative XDG_CONFIG_HOME. */
export function autostartDir(env: { XDG_CONFIG_HOME?: string }, home: string): string {
  const config = env.XDG_CONFIG_HOME && posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : posix.join(home, ".config");
  return posix.join(config, "autostart");
}

/** Quote one Exec argument; inside quotes, \ " ` and $ take a backslash. */
function quoteArg(arg: string): string {
  if (/[\r\n]/.test(arg)) throw new Error("A path with a line break can't go in an autostart entry");
  return `"${arg.replace(/[\\"`$]/g, "\\$&")}"`;
}

export function buildDesktopEntry(o: { bun: string; cliJs: string }): string {
  const exec = `${quoteArg(o.bun)} ${quoteArg(o.cliJs)} --boot`;
  // % starts a field code, and the string escape rule (\\ for \) applies on top of the
  // quoting, so a literal backslash ends up as four.
  const value = exec.replace(/%/g, "%%").replace(/\\/g, "\\\\");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Token Larper",
    "Comment=Start the Token Larper dashboard at login",
    `Exec=${value}`,
    "Terminal=false",
    "NoDisplay=true",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** Desktops turn an autostart entry off with Hidden=true or X-GNOME-Autostart-enabled=false. */
export function parseDesktopEntry(text: string): { args: string[] | null; disabled: boolean } {
  let inMain = false;
  let exec: string | null = null;
  let disabled = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inMain = line === "[Desktop Entry]";
      continue;
    }
    if (!inMain || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "Exec") exec = value;
    else if (key === "Hidden" && value === "true") disabled = true;
    else if (key === "X-GNOME-Autostart-enabled" && value === "false") disabled = true;
  }
  return { args: exec === null ? null : splitExec(exec), disabled };
}

const STRING_ESCAPES: Record<string, string> = { "\\": "\\", s: " ", n: "\n", t: "\t", r: "\r" };

/** Split an Exec value into arguments, undoing buildDesktopEntry's escaping. */
export function splitExec(value: string): string[] {
  const exec = value.replace(/\\([\\sntr])/g, (_, c: string) => STRING_ESCAPES[c]!);
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let inArg = false;
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i]!;
    if (quoted) {
      if (c === "\\" && i + 1 < exec.length) current += exec[++i]!;
      else if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"') {
      quoted = true;
      inArg = true;
    } else if (c === " " || c === "\t") {
      if (inArg) args.push(current);
      current = "";
      inArg = false;
    } else {
      current += c;
      inArg = true;
    }
  }
  if (inArg) args.push(current);
  return args.map((a) => a.replace(/%%/g, "%"));
}
```

- [ ] **Step 6: Run the tests and see them pass**

Run: `bun test src/startup`
Expected: all tests in the three files pass.

- [ ] **Step 7: Typecheck**

Run: `bunx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/startup/backend.ts src/startup/backend.test.ts src/startup/launchAgent.ts src/startup/launchAgent.test.ts src/startup/desktopEntry.ts src/startup/desktopEntry.test.ts
git commit -m "feat(startup): build and read macOS LaunchAgent and Linux autostart entries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Stale-entry decision

**Files:**
- Create: `src/startup/repoint.ts`
- Test: `src/startup/repoint.test.ts`

**Interfaces:**
- Consumes: `EntryState` (Task 2), `compareVersions` (Task 1).
- Produces: `shouldRepoint(o: { state: EntryState; isThisCopy: boolean; targetExists: boolean; targetVersion: string | null; appVersion: string }): boolean`

- [ ] **Step 1: Write the failing test**

`src/startup/repoint.test.ts`:

```ts
import { expect, test } from "bun:test";
import { shouldRepoint } from "./repoint.ts";

const entry = { entry: "bun /old/bin/cli.js --boot", target: "/old/bin/cli.js", disabledBySystem: false };
const base = { state: entry, isThisCopy: false, targetExists: true, targetVersion: "1.11.0", appVersion: "1.12.0" };

test("an entry for an older copy is repointed", () => {
  expect(shouldRepoint(base)).toBe(true);
});

test("an entry for a deleted copy is repointed", () => {
  expect(shouldRepoint({ ...base, targetExists: false, targetVersion: null })).toBe(true);
});

test("an entry for this copy, a newer copy or the same version is left alone", () => {
  expect(shouldRepoint({ ...base, isThisCopy: true })).toBe(false);
  expect(shouldRepoint({ ...base, targetVersion: "1.13.0" })).toBe(false);
  expect(shouldRepoint({ ...base, targetVersion: "1.12.0" })).toBe(false);
});

test("a beta entry is repointed to its release", () => {
  expect(shouldRepoint({ ...base, targetVersion: "1.12.0-beta.2" })).toBe(true);
});

test("no entry, or one the user turned off in the OS, is never touched", () => {
  expect(shouldRepoint({ ...base, state: { entry: null, target: null, disabledBySystem: false } })).toBe(false);
  expect(shouldRepoint({ ...base, state: { ...entry, disabledBySystem: true } })).toBe(false);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `bun test src/startup/repoint.test.ts`
Expected: FAIL, module `./repoint.ts` not found.

- [ ] **Step 3: Implement**

`src/startup/repoint.ts`:

```ts
import { compareVersions } from "../semver.ts";
import type { EntryState } from "./backend.ts";

/**
 * npx and bunx put every version in its own folder, so an entry made by an older version
 * keeps starting that version. Repoint an entry at this copy when it starts an older or
 * deleted one. Never touch an entry the user turned off in the OS's settings.
 */
export function shouldRepoint(o: {
  state: EntryState;
  isThisCopy: boolean;
  targetExists: boolean;
  targetVersion: string | null;
  appVersion: string;
}): boolean {
  if (!o.state.target || o.isThisCopy || o.state.disabledBySystem) return false;
  if (o.targetExists && o.targetVersion !== null && compareVersions(o.targetVersion, o.appVersion) >= 0) return false;
  return true;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `bun test src/startup/repoint.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/startup/repoint.ts src/startup/repoint.test.ts
git commit -m "feat(startup): decide when a stale login entry is repointed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Per-OS backends and the new `StartupConfig`

Wire everything up: move the registry code into `windows.ts`, add the macOS and Linux backends, switch `startup.ts` to delegate, and change `StartupConfig`. Settings keeps compiling by reading `entry` instead of `registryValue`. The wording changes come in Task 6.

**Files:**
- Create: `src/startup/run.ts`, `src/startup/windows.ts`, `src/startup/macos.ts`, `src/startup/linux.ts`
- Modify: `src/startup.ts` (whole file), `src/types.ts:170-176`, `src/client/components/SettingsDialog.tsx:198`, `scripts/docs-demo-server.ts:136`, `docs/superpowers/specs/2026-10-03-macos-linux-tray-startup-design.md`

**Interfaces:**
- Consumes: everything from Tasks 2 and 3.
- Produces: `StartupConfig` with `platform`, `entry`, `entryPath`, `disabledBySystem` (used by Task 6). The exported functions of `src/startup.ts` keep their signatures: `getStartupStatus(defaultPort?: number): Promise<StartupConfig>`, `setStartupStatus(options: { enabled: boolean; openBrowserOnBoot?: boolean; port?: number }): Promise<StartupConfig>`, `repointStartupIfStale(): Promise<void>`.

- [ ] **Step 1: Change `StartupConfig` in `src/types.ts`**

Replace the interface (lines 170-176) with:

```ts
export interface StartupConfig {
  enabled: boolean;
  openBrowserOnBoot: boolean;
  port: number;
  platform: "windows" | "macos" | "linux";
  /** The command the login entry runs, or null when there is none. */
  entry: string | null;
  /** Registry value, LaunchAgent plist or autostart .desktop file. */
  entryPath: string;
  /** This copy has an entry, but the user turned it off in the OS's own settings. */
  disabledBySystem: boolean;
  launcherPath: string;
}
```

- [ ] **Step 2: Create `src/startup/run.ts`**

```ts
/** Run a program and collect its output and exit code (reg.exe, launchctl). */
export async function run(argv: string[]): Promise<{ code: number; output: string; error: string }> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [output, error, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output, error };
}
```

- [ ] **Step 3: Create `src/startup/windows.ts` (the registry code moved from `src/startup.ts`)**

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT } from "../paths.ts";
import { NO_ENTRY, type EntryState, type StartupBackend } from "./backend.ts";
import { run } from "./run.ts";

const REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const REG_VALUE_NAME = "TokenLarper";
const VBS_LAUNCHER = join(APP_ROOT, "scripts", "launch-silent.vbs");
const PS1_RUNNER = join(APP_ROOT, "scripts", "run-server.ps1");
const COMMAND = `wscript.exe //B //Nologo "${VBS_LAUNCHER}"`;

async function readRegistryValue(): Promise<string | null> {
  const result = await run(["reg.exe", "query", REG_KEY, "/v", REG_VALUE_NAME]);
  if (result.code !== 0) return null;
  const line = result.output.split(/\r?\n/).find((part) =>
    new RegExp(`^\\s*${REG_VALUE_NAME}\\s+REG_\\w+\\s+`, "i").test(part)
  );
  return line?.match(/^\s*\S+\s+REG_\w+\s+(.+)$/i)?.[1]?.trim() ?? null;
}

export const windowsBackend: StartupBackend = {
  platform: "windows",
  entryPath: `${REG_KEY}\\${REG_VALUE_NAME}`,
  launcherPath: VBS_LAUNCHER,
  assertCanEnable() {
    if (!existsSync(VBS_LAUNCHER) || !existsSync(PS1_RUNNER)) throw new Error("The Windows startup launcher is missing");
  },
  async read(): Promise<EntryState> {
    const value = await readRegistryValue();
    if (!value) return NO_ENTRY;
    return { entry: value, target: value.match(/"([^"]*launch-silent\.vbs)"/i)?.[1] ?? null, disabledBySystem: false };
  },
  async write() {
    const result = await run(["reg.exe", "add", REG_KEY, "/v", REG_VALUE_NAME, "/t", "REG_SZ", "/d", COMMAND, "/f"]);
    if (result.code !== 0) throw new Error(result.error.trim() || "Could not enable Windows startup");
  },
  async remove() {
    const result = await run(["reg.exe", "delete", REG_KEY, "/v", REG_VALUE_NAME, "/f"]);
    if (result.code !== 0) throw new Error(result.error.trim() || "Could not disable Windows startup");
  },
};
```

- [ ] **Step 4: Create `src/startup/macos.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { APP_ROOT, dataPath } from "../paths.ts";
import { bootTarget, displayCommand, NO_ENTRY, type EntryState, type StartupBackend } from "./backend.ts";
import { buildPlist, isLabelDisabled, LAUNCH_AGENT_LABEL, parsePlistArgs } from "./launchAgent.ts";
import { run } from "./run.ts";

const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
const CLI_JS = join(APP_ROOT, "bin", "cli.js");

/** Turning the item off in System Settings → Login Items shows up as a disabled label. */
async function turnedOffInSystemSettings(): Promise<boolean> {
  const uid = process.getuid?.();
  if (uid === undefined) return false;
  try {
    const result = await run(["launchctl", "print-disabled", `gui/${uid}`]);
    return result.code === 0 && isLabelDisabled(result.output);
  } catch {
    return false;
  }
}

export const macosBackend: StartupBackend = {
  platform: "macos",
  entryPath: PLIST_PATH,
  launcherPath: CLI_JS,
  assertCanEnable() {
    if (!existsSync(CLI_JS)) throw new Error(`Token Larper's launcher is missing (${CLI_JS})`);
  },
  async read(): Promise<EntryState> {
    if (!existsSync(PLIST_PATH)) return NO_ENTRY;
    const args = parsePlistArgs(readFileSync(PLIST_PATH, "utf8"));
    return {
      entry: args ? displayCommand(args) : "Unreadable LaunchAgent file",
      target: bootTarget(args),
      disabledBySystem: await turnedOffInSystemSettings(),
    };
  },
  // macOS shows "Background Items Added" for a new agent; that notice is the user's to see.
  async write() {
    mkdirSync(dirname(PLIST_PATH), { recursive: true });
    writeFileSync(PLIST_PATH, buildPlist({ bun: process.execPath, cliJs: CLI_JS, logFile: dataPath("login-agent.log") }), "utf8");
  },
  // Removing the file is enough: a RunAtLoad agent only runs when loaded at login, and
  // unloading it (launchctl bootout) could signal the server that is running now.
  async remove() {
    rmSync(PLIST_PATH, { force: true });
  },
};
```

- [ ] **Step 5: Create `src/startup/linux.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";
import { APP_ROOT } from "../paths.ts";
import { bootTarget, displayCommand, NO_ENTRY, type EntryState, type StartupBackend } from "./backend.ts";
import { autostartDir, buildDesktopEntry, DESKTOP_FILE_NAME, parseDesktopEntry } from "./desktopEntry.ts";

const DESKTOP_PATH = posix.join(autostartDir(process.env, homedir()), DESKTOP_FILE_NAME);
const CLI_JS = join(APP_ROOT, "bin", "cli.js");

export const linuxBackend: StartupBackend = {
  platform: "linux",
  entryPath: DESKTOP_PATH,
  launcherPath: CLI_JS,
  assertCanEnable() {
    if (!existsSync(CLI_JS)) throw new Error(`Token Larper's launcher is missing (${CLI_JS})`);
  },
  async read(): Promise<EntryState> {
    if (!existsSync(DESKTOP_PATH)) return NO_ENTRY;
    const parsed = parseDesktopEntry(readFileSync(DESKTOP_PATH, "utf8"));
    return {
      entry: parsed.args ? displayCommand(parsed.args) : "Unreadable autostart file",
      target: bootTarget(parsed.args),
      disabledBySystem: parsed.disabled,
    };
  },
  async write() {
    mkdirSync(posix.dirname(DESKTOP_PATH), { recursive: true });
    writeFileSync(DESKTOP_PATH, buildDesktopEntry({ bun: process.execPath, cliJs: CLI_JS }), "utf8");
  },
  async remove() {
    rmSync(DESKTOP_PATH, { force: true });
  },
};
```

- [ ] **Step 6: Replace `src/startup.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StartupConfig } from "./types.ts";
import { APP_VERSION, DATA_DIR, dataPath } from "./paths.ts";
import { NO_ENTRY, samePath, type EntryState, type StartupBackend } from "./startup/backend.ts";
import { linuxBackend } from "./startup/linux.ts";
import { macosBackend } from "./startup/macos.ts";
import { shouldRepoint } from "./startup/repoint.ts";
import { windowsBackend } from "./startup/windows.ts";

const SETTINGS_FILE = dataPath("settings.json");

interface SavedSettings {
  openBrowserOnBoot: boolean;
  port: number;
}

function validPort(value: unknown, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function loadSavedSettings(defaultPort = 4269): SavedSettings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
      return {
        openBrowserOnBoot: raw.openBrowserOnBoot === true,
        port: validPort(raw.port, defaultPort),
      };
    }
  } catch {
    // A missing or damaged settings file falls back to the default port.
  }
  return { openBrowserOnBoot: false, port: defaultPort };
}

function saveSettings(settings: SavedSettings): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

function backend(): StartupBackend {
  if (process.platform === "win32") return windowsBackend;
  if (process.platform === "darwin") return macosBackend;
  return linuxBackend;
}

async function readState(b: StartupBackend): Promise<EntryState> {
  try {
    return await b.read();
  } catch {
    // Status stays readable if reg.exe or launchctl is unavailable.
    return NO_ENTRY;
  }
}

export async function getStartupStatus(defaultPort = 4269): Promise<StartupConfig> {
  const saved = loadSavedSettings(defaultPort);
  const b = backend();
  const state = await readState(b);
  const ours = state.target !== null && samePath(state.target, b.launcherPath, b.platform);
  return {
    enabled: ours && !state.disabledBySystem,
    openBrowserOnBoot: saved.openBrowserOnBoot,
    port: defaultPort,
    platform: b.platform,
    entry: state.entry,
    entryPath: b.entryPath,
    disabledBySystem: ours && state.disabledBySystem,
    launcherPath: b.launcherPath,
  };
}

export async function setStartupStatus(options: {
  enabled: boolean;
  openBrowserOnBoot?: boolean;
  port?: number;
}): Promise<StartupConfig> {
  const current = loadSavedSettings();
  const next: SavedSettings = {
    openBrowserOnBoot: options.openBrowserOnBoot ?? current.openBrowserOnBoot,
    port: validPort(options.port ?? current.port, current.port),
  };

  const b = backend();
  if (options.enabled) {
    b.assertCanEnable();
    await b.write();
  } else if ((await readState(b)).entry !== null) {
    await b.remove();
  }

  saveSettings(next);
  return getStartupStatus(next.port);
}

function versionAt(launcher: string): string | null {
  try {
    // Both launchers sit two folders below the package root: scripts/launch-silent.vbs, bin/cli.js.
    const pkg = join(launcher, "..", "..", "package.json");
    return String(JSON.parse(readFileSync(pkg, "utf8")).version || "0.0.0");
  } catch {
    return null;
  }
}

/** When startup is on and the entry starts an older or deleted copy, point it at this one. */
export async function repointStartupIfStale(): Promise<void> {
  try {
    const b = backend();
    const state = await b.read();
    const target = state.target;
    if (!target) return;
    const repoint = shouldRepoint({
      state,
      isThisCopy: samePath(target, b.launcherPath, b.platform),
      targetExists: existsSync(target),
      targetVersion: versionAt(target),
      appVersion: APP_VERSION,
    });
    if (!repoint) return;
    b.assertCanEnable();
    await b.write();
  } catch {
    // The old entry keeps working; Settings can turn startup off and on again.
  }
}
```

- [ ] **Step 7: Keep Settings compiling**

In `src/client/components/SettingsDialog.tsx` line 198, change `startup.registryValue` to `startup.entry`:

```tsx
                  <dd><code>{startup.entry || "Not registered"}</code></dd>
```

- [ ] **Step 8: Update the demo server's sample response**

In `scripts/docs-demo-server.ts` line 136, replace the `/api/startup` line with:

```ts
    if (path === "/api/startup" && request.method === "GET") return Response.json({ enabled: false, openBrowserOnBoot: false, port, platform: "windows", entry: null, entryPath: "Sample dashboard", disabledBySystem: false, launcherPath: "Sample dashboard" });
```

- [ ] **Step 9: Update the spec's macOS disable step**

In `docs/superpowers/specs/2026-10-03-macos-linux-tray-startup-design.md`, replace the line

```
- Disable: `launchctl bootout gui/<uid>/com.tokenlarper.agent` (ignore "not loaded"), then delete the plist.
```

with

```
- Disable: delete the plist. A `RunAtLoad` agent only runs when it is loaded at login, so there is nothing to unload, and `launchctl bootout` could signal the server that is running now.
```

- [ ] **Step 10: Typecheck, test, build**

Run: `bunx tsc --noEmit -p .` then `bun test` then `bun run build`
Expected: all pass. A search for `registryValue` in `src` and `scripts` finds nothing.

- [ ] **Step 11: Windows regression check (on the owner's machine, with their OK)**

This writes the owner's real registry key, so ask before running. Then: `$env:NO_TRAY="1"; bun src/server.ts`, open `http://localhost:4269`, Settings → turn **Start with Windows** on, check `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v TokenLarper` shows `wscript.exe //B //Nologo "<worktree>\scripts\launch-silent.vbs"`, then turn it back to the state it was in before the check.
Expected: the same value and behavior as `main`. If the owner had startup on with another copy, Settings shows it off (the entry starts another copy), the same as on `main`.

- [ ] **Step 12: Commit**

```bash
git add src/startup.ts src/startup/run.ts src/startup/windows.ts src/startup/macos.ts src/startup/linux.ts src/types.ts src/client/components/SettingsDialog.tsx scripts/docs-demo-server.ts docs/superpowers/specs/2026-10-03-macos-linux-tray-startup-design.md
git commit -m "feat(startup): start at login on macOS and Linux

Turning startup on outside Windows used to save the setting and report it
off. macOS now gets a LaunchAgent and Linux an XDG autostart entry, both
running bin/cli.js --boot; Windows keeps its registry entry unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `--boot` in the CLI

**Files:**
- Modify: `bin/cli.js`

**Interfaces:**
- Consumes: the login command `<bun> <bin/cli.js> --boot` written by Task 4.
- Produces: `token-larper --boot` reads `settings.json` in the data folder (`port`, `openBrowserOnBoot`), starts the server in the background on that port unless one already answers, opens the browser only when `openBrowserOnBoot` is true, writes `startup-error.log` on failure and deletes it on success.

- [ ] **Step 1: Add `writeFileSync` and `rmSync` to the fs import (line 3)**

```js
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
```

- [ ] **Step 2: Add `--boot` to the help text**

Replace the `HELP` constant with:

```js
const HELP = `Token Larper: a local dashboard for AI coding token usage.

Usage:
  token-larper                Start in the background and open the dashboard
  token-larper --foreground   Run in this terminal and show logs (Ctrl+C stops it)
  token-larper --no-open      Start without opening the browser
  token-larper --boot         What the login entry runs: start with the saved port and browser setting
  token-larper stop           Stop the running copy

Environment: PORT (default 4269), TOKEN_LARPER_DATA_DIR, NO_TRAY=1`;
```

- [ ] **Step 3: Add `savedSettings()` and `boot()` after `openBrowser()`**

```js
// The settings the dashboard saves (src/startup.ts); read at login so the entry never changes.
function savedSettings() {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir(), "settings.json"), "utf8"));
    const saved = Number(raw.port);
    return {
      port: Number.isInteger(saved) && saved > 0 && saved <= 65535 ? saved : 4269,
      openOnBoot: raw.openBrowserOnBoot === true,
    };
  } catch {
    return { port: 4269, openOnBoot: false };
  }
}

/** The login entry on macOS and Linux runs this; scripts/run-server.ps1 does the same on Windows. */
async function boot() {
  const { port: bootPort, openOnBoot } = savedSettings();
  if (await isRunning(bootPort)) {
    if (openOnBoot) openBrowser(`http://localhost:${bootPort}`);
    process.exit(0);
  }
  process.env.PORT = String(bootPort);
  await background(openOnBoot, { boot: true });
}
```

- [ ] **Step 4: Let `background()` record boot failures**

Change the signature and add the error-log handling. Replace

```js
async function background(open) {
  const bun = bunPath();
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, "server.log");
```

with

```js
async function background(open, { boot = false } = {}) {
  const bun = bunPath();
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, "server.log");
  const errorLog = join(dir, "startup-error.log");
```

Replace the "replacing an older copy" message so it shows the port the server was started with:

```js
    console.log(`🔥 Token Larper is replacing an older copy. It will be at http://localhost:${process.env.PORT || port} in a minute.`);
```

At the start of the `if (!url) {` block, add the boot log as the first line:

```js
  if (!url) {
    if (boot) writeFileSync(errorLog, `Token Larper didn't start at login. See ${logFile}\n`, "utf8");
```

Right after that block (before `console.log(\`🔥 Token Larper is running at ${url}\`);`), add:

```js
  if (boot) rmSync(errorLog, { force: true });
```

- [ ] **Step 5: Dispatch `--boot`**

Replace the dispatch at the bottom with:

```js
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
} else if (args[0] === "stop") {
  await stop();
} else if (args.includes("--boot")) {
  await boot();
} else if (args.includes("--foreground") || args.includes("-f")) {
  bunPath();
  await foreground();
} else {
  await background(!args.includes("--no-open") && process.env.TOKEN_LARPER_NO_BROWSER !== "1");
}
```

- [ ] **Step 6: Smoke test with a throwaway data folder (no tray, no browser)**

In PowerShell, from the worktree:

```powershell
$d = Join-Path $env:TEMP "tl-boot-test"; New-Item -ItemType Directory -Force $d | Out-Null
'{ "port": 4371, "openBrowserOnBoot": false }' | Set-Content -Encoding utf8 (Join-Path $d "settings.json")
$env:TOKEN_LARPER_DATA_DIR = $d; $env:NO_TRAY = "1"
bun bin/cli.js --boot
```

Expected: prints `🔥 Token Larper is running at http://localhost:4371`; no browser opens; `Invoke-RestMethod http://127.0.0.1:4371/api/version` returns the version.

Run `bun bin/cli.js --boot` again.
Expected: exits right away with code 0 (already running) and starts nothing new.

Clean up: `$env:PORT = "4371"; bun bin/cli.js stop; Remove-Item Env:PORT, Env:NO_TRAY, Env:TOKEN_LARPER_DATA_DIR; Remove-Item -Recurse -Force $d`
Expected: `Stopped Token Larper.`

- [ ] **Step 7: Commit**

```bash
git add bin/cli.js
git commit -m "feat(cli): add --boot for the macOS and Linux login entries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Settings wording per platform

**Files:**
- Create: `src/client/lib/startupCopy.ts`
- Test: `src/client/lib/startupCopy.test.ts`
- Modify: `src/client/components/SettingsDialog.tsx:136-205`

**Interfaces:**
- Consumes: `StartupConfig` from Task 4.
- Produces: `startupCopy(s: Pick<StartupConfig, "platform" | "enabled" | "disabledBySystem">): { toggleLabel: string; status: string; toggleHint: string; toggleDisabled: boolean; browserHint: string; entryLabel: string }`

- [ ] **Step 1: Write the failing test**

`src/client/lib/startupCopy.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and see it fail**

Run: `bun test src/client/lib/startupCopy.test.ts`
Expected: FAIL, module `./startupCopy.ts` not found.

- [ ] **Step 3: Implement**

`src/client/lib/startupCopy.ts`:

```ts
import type { StartupConfig } from "../../types.ts";

/**
 * Startup wording for Settings. Windows keeps its existing text. When the user turned the
 * macOS login item off in System Settings, only System Settings can turn it back on, so
 * the switch is disabled there instead of overriding their choice.
 */
export function startupCopy(s: Pick<StartupConfig, "platform" | "enabled" | "disabledBySystem">) {
  const windows = s.platform === "windows";
  const macos = s.platform === "macos";
  const toggleLabel = windows ? "Start with Windows" : "Start at login";

  let status = "Manual launch";
  if (s.enabled) status = windows ? "Starts with Windows" : "Starts at login";
  else if (s.disabledBySystem) status = macos ? "Turned off in System Settings" : "Turned off in your desktop's startup settings";

  let toggleHint = "Launch Token Larper when you sign in.";
  if (s.disabledBySystem) {
    toggleHint = macos
      ? "Turn Token Larper back on in System Settings → General → Login Items."
      : "Your desktop's startup settings turned it off. Switch it on here to start it at login again.";
  }

  return {
    toggleLabel,
    status,
    toggleHint,
    toggleDisabled: macos && s.disabledBySystem,
    browserHint: s.enabled ? "Open the dashboard in your browser after launch." : `Takes effect when ${toggleLabel} is on.`,
    entryLabel: windows ? "Windows startup" : macos ? "Login item" : "Autostart entry",
  };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `bun test src/client/lib/startupCopy.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Use it in `SettingsDialog.tsx`**

Add the import next to the other imports at the top of the file:

```tsx
import { startupCopy } from "../lib/startupCopy.ts";
```

Replace the startup section and the technical details (lines 136-205, from `{startup ? (` through the closing `)}` of the `<details>` block) with:

```tsx
          {startup ? (() => {
            const copy = startupCopy(startup);
            return (
              <section className="settings-section" aria-labelledby="settings-startup-heading">
                <div className="settings-section-heading">
                  <h4 id="settings-startup-heading">Startup</h4>
                  <span>{copy.status}</span>
                </div>
                <div className="setting-row">
                  <div className="setting-copy">
                    <strong id="setting-autostart-label">{copy.toggleLabel}</strong>
                    <p>{copy.toggleHint}</p>
                  </div>
                  <button
                    disabled={saving || copy.toggleDisabled}
                    className={`toggle ${startup.enabled ? "on" : ""}`}
                    role="switch"
                    aria-labelledby="setting-autostart-label"
                    aria-checked={startup.enabled}
                    onClick={() => onToggleStartup(!startup.enabled)}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <div className="setting-row">
                  <div className="setting-copy">
                    <strong id="setting-browser-label">Open dashboard at sign-in</strong>
                    <p>{copy.browserHint}</p>
                  </div>
                  <button
                    disabled={saving}
                    className={`toggle ${startup.openBrowserOnBoot ? "on" : ""}`}
                    role="switch"
                    aria-labelledby="setting-browser-label"
                    aria-checked={startup.openBrowserOnBoot}
                    onClick={() => onToggleStartup(startup.enabled, !startup.openBrowserOnBoot)}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </section>
            );
          })() : (
            <div className="settings-empty">
              <p>Startup settings are unavailable.</p>
              <button className="btn" onClick={onRetry}>Try again</button>
            </div>
          )}
          <UpdateSettings updates={updates} autoCheck={checkUpdates} onAutoCheckChange={onCheckUpdatesChange} />
          {startup && (
            <details className="settings-details">
              <summary>
                Technical details <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <dl>
                <div>
                  <dt>Dashboard</dt>
                  <dd><code>http://127.0.0.1:{startup.port}</code></dd>
                </div>
                <div>
                  <dt>{startupCopy(startup).entryLabel}</dt>
                  <dd><code>{startup.entry || "Not registered"}</code></dd>
                </div>
                {startup.platform !== "windows" && (
                  <div>
                    <dt>Entry file</dt>
                    <dd><code>{startup.entryPath}</code></dd>
                  </div>
                )}
                <div>
                  <dt>Launcher</dt>
                  <dd><code>{startup.launcherPath}</code></dd>
                </div>
              </dl>
            </details>
          )}
```

- [ ] **Step 6: Typecheck, test, build**

Run: `bunx tsc --noEmit -p .` then `bun test` then `bun run build`
Expected: all pass.

- [ ] **Step 7: Look at Settings in the browser**

Start the demo server (it serves the dashboard with sample data and the Windows sample from Task 4): `bun scripts/docs-demo-server.ts`, open the URL it prints, open Settings.
Expected: the Startup section reads "Manual launch" / "Start with Windows" / "Launch Token Larper when you sign in." exactly as before, and Technical details shows "Windows startup: Not registered" and "Launcher: Sample dashboard". Then temporarily edit the sample to `platform: "macos", disabledBySystem: true` and reload: the status reads "Turned off in System Settings", the switch is disabled, and "Entry file" appears. Undo the temporary edit.

- [ ] **Step 8: Commit**

```bash
git add src/client/lib/startupCopy.ts src/client/lib/startupCopy.test.ts src/client/components/SettingsDialog.tsx
git commit -m "feat(settings): show start-at-login wording for each platform

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: README, version bump, PR

**Files:**
- Modify: `README.md`, `package.json:3`

- [ ] **Step 1: Uninstall step 1 (README lines 226-240)**

Replace the paragraph `On macOS and Linux, stopping it is enough. If you set up your own LaunchAgent or \`systemd --user\` unit for it, remove that too.` with:

````markdown
On macOS and Linux, turn off **Start at login** in **Settings** the same way, then stop it. If you already deleted the app, remove the entry by hand:

```bash
# macOS
rm ~/Library/LaunchAgents/com.tokenlarper.agent.plist
# Linux
rm "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/token-larper.desktop"
```

If you set up your own `systemd --user` unit for it, remove that too.
````

Also change the sentence at line 224 from `the Windows startup entry points at the app folder` to `the startup entry points at the app folder`.

- [ ] **Step 2: Replace "Auto-Start on Windows Boot" (README lines 293-299)**

````markdown
### Start at Login

Token Larper can start in the background when you sign in. It's off until you turn it on.

* **Windows**: Right-click the **`t.`** tray icon and click **Start on Windows Boot**, or turn on **Start with Windows** in **Settings**. *(This adds a user entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\TokenLarper` that runs the windowless launcher.)*
* **macOS**: Turn on **Start at login** in **Settings**. This adds `~/Library/LaunchAgents/com.tokenlarper.agent.plist`. macOS then shows a "Background Items Added" notice and lists Token Larper under **System Settings → General → Login Items**, where you can also turn it off.
* **Linux**: Turn on **Start at login** in **Settings**. This adds `~/.config/autostart/token-larper.desktop` (or under `$XDG_CONFIG_HOME`), which GNOME, KDE and other desktops run when you log in.

Turn on **Open dashboard at sign-in** as well if you want your browser to open to the dashboard after login. Settings → Technical details shows the exact entry.
````

- [ ] **Step 3: Headless section (README lines 332-336)**

Replace the section with:

````markdown
### Headless Server Mode
On a remote server or in a container, turn the tray off explicitly:
```bash
NO_TRAY=1 bun start
```

**Start at login** needs a desktop session. On a Linux machine without one, use a `systemd --user` service instead (adjust the paths to your Bun and Token Larper):
```ini
# ~/.config/systemd/user/token-larper.service
[Unit]
Description=Token Larper

[Service]
Environment=NO_TRAY=1
ExecStart=%h/.bun/bin/bun %h/token-larper/src/server.ts
Restart=on-failure

[Install]
WantedBy=default.target
```
```bash
systemctl --user enable --now token-larper
loginctl enable-linger "$USER"   # keep it running when you're logged out
```
````

- [ ] **Step 4: Bump the version**

Read `package.json` and the current `main` version (`git show origin/main:package.json`). Set `"version"` to the next minor above `main`; with `main` at `1.11.0` that's `"1.12.0"`.

- [ ] **Step 5: Full check**

Run: `bunx tsc --noEmit -p .` then `bun test` then `bun run build`
Expected: all pass.

- [ ] **Step 6: Commit both**

```bash
git add README.md
git commit -m "docs: start at login on macOS and Linux

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add package.json
git commit -m "chore(release): bump version to 1.12.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Ask the owner, then push and open the PR**

Pushing and opening a PR are outward-facing: confirm with the owner first. Then:

```powershell
git push -u origin feat/login-startup-mac-linux
& "C:/Program Files/GitHub CLI/gh.exe" pr create --base main --head feat/login-startup-mac-linux --title "feat(startup): start at login on macOS and Linux" --body-file <scratchpad>/pr1-body.md
```

The PR body covers: what was broken (toggle silently flipped back outside Windows), the LaunchAgent and autostart entries, `--boot`, the Settings wording, the semver fix, that Windows is unchanged, test results, and the Ubuntu manual checklist below as unchecked items. It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 8: Hand the owner the Ubuntu checklist**

1. On the Ubuntu VM, check out the branch, `bun install`, `bun bin/cli.js`, open Settings: Startup reads "Manual launch" and the switch says **Start at login**.
2. Turn it on: status reads "Starts at login", and `cat ~/.config/autostart/token-larper.desktop` shows `Exec="<bun>" "<repo>/bin/cli.js" --boot`.
3. Log out and back in: `curl -s http://127.0.0.1:4269/api/version` answers without starting anything by hand.
4. Turn on **Open dashboard at sign-in**, log out and in: the browser opens to the dashboard.
5. Turn **Start at login** off: the file is gone; log out and in, and nothing starts.
6. In GNOME Tweaks → Startup Applications (if installed), turn the entry off with startup on: Settings reads "Turned off in your desktop's startup settings"; switching it on in Settings turns it back on.

macOS is checked by testers in the PR 5 beta (spec, "Manual test checklists").

---

## Self-review notes

- Spec Part 1 coverage: `--boot` (Task 5), LaunchAgent and autostart entries (Tasks 2 and 4), status including the System Settings and desktop-disabled cases (Tasks 2, 4 and 6), code layout (Task 4), stale-entry repair on all platforms that skips disabled entries (Tasks 3 and 4), `StartupConfig` and Settings (Tasks 4 and 6), Windows-only launcher check (Task 4, `assertCanEnable`), errors shown in Settings (existing 500 path, now reached on every OS), tests (Tasks 1-6), manual Ubuntu test (Task 7). Version fix from Part 4: Task 1. README: Task 7.
- One deliberate change from the spec: macOS disable no longer runs `launchctl bootout` (Task 4, Step 9 updates the spec).
- One assumption the macOS testers must confirm: that turning the item off in **System Settings → Login Items** shows up in `launchctl print-disabled`. If it doesn't, the dashboard shows the toggle as on while macOS won't run it; the fix then belongs in PR 5 with tester feedback.
- Windows changes only in structure: the registry code moved to `src/startup/windows.ts` with the same key, value and command. One small difference: an entry in any format that starts this copy's `launch-silent.vbs` now reads as on (it was compared as a whole string before); every version writes the same format, so in practice nothing changes.
