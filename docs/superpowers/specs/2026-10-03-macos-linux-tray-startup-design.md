# macOS and Linux tray and start-at-login

Date: 2026-10-03
Status: Draft, awaiting review

## Goal

Give macOS and Linux users the same tray and start-at-login experience Windows users have today, as close to the Windows look and behavior as each platform allows, without working around any operating system permission or security mechanism.

## Background

- The tray is Windows-only. `src/tray.ts` generates a PowerShell WinForms script and returns early on any other platform. The script polls `/api/tray-status` and posts to `/api/startup` and `/api/shutdown`; every string it shows is formatted in `src/trayStatus.ts`.
- Start-at-login is Windows-only, and broken elsewhere: on macOS and Linux, `setStartupStatus` skips the registry step, saves the setting, and reports `enabled: false`. The Settings toggle flips back with no error, and the panel says "Starts with Windows".
- Windows starts at login through `HKCU\...\Run` → `scripts/launch-silent.vbs` → `scripts/run-server.ps1`, which reads `settings.json` for the port and `openBrowserOnBoot`, starts the server if it isn't running, and opens the browser if asked.

## Principles

1. **Match Windows.** Same menu items in the same order, same popup layout and theme colors, same polling rhythm, same Quit behavior. Differences exist only where the platform can't do what Windows does, and each one is listed below.
2. **Use the platform's own mechanisms; never hide or bypass anything it shows the user.** No admin rights, sudo, root, polkit, or system bus. No suppressing the macOS "Background Items Added" notice. Never removing the quarantine attribute (`xattr -d`) or telling users to.
3. **Consent comes from the toggle.** Start-at-login is off by default and only created when the user turns it on, from Settings or the tray menu. Updates never turn it on. The stale-entry repair only rewrites an entry that is already on.
4. **Fail soft.** If a tray or startup step fails, the server keeps running, the dashboard still works, and the reason is in `server.log` or shown in Settings.

## Scope

In scope:

- Start-at-login on macOS (LaunchAgent) and Linux (XDG autostart).
- macOS menu bar icon with a popover and menu.
- Linux tray icon on Ubuntu's default GNOME (with its bundled AppIndicator extension) and KDE Plasma.
- CI build of the macOS helper, and a beta npm channel for testers.

Out of scope:

- Headless Linux (no desktop session). The README gives a `systemd --user` example instead.
- Plain GNOME without the AppIndicator extension, beyond detecting it and logging how to enable it.
- XFCE, Cinnamon, MATE: may work through the same protocol, but not tested or promised.
- Developer ID signing and notarization for macOS. Ad-hoc signing for now; revisit if an Apple Developer account is set up.
- Any change to the Windows tray or Windows startup behavior.

## Part 1: Start-at-login

### Login command

`bin/cli.js` gains a `--boot` flag, the cross-platform equivalent of `run-server.ps1`:

1. Read `settings.json` from the data folder for `port` and `openBrowserOnBoot`, falling back to 4269 and `false`.
2. If a Token Larper already answers on that port, open the browser when `openBrowserOnBoot` is on, then exit.
3. Otherwise start the server in the background, as `background()` does today, wait until it is ready, and open the browser only when `openBrowserOnBoot` is on.
4. On failure, write the reason to `startup-error.log` in the data folder and exit 1. A successful start deletes that file.

- macOS and Linux refuse to turn it on from a temporary bunx copy (the app folder is inside the OS temp folder, or a path segment starts with "bunx-"), because the OS clears that folder; the error tells the user to install with "bun add -g token-larper". Windows is unchanged.

The setting is read at login, so the startup entry never needs rewriting when it changes. The entry stores absolute paths to Bun (`process.execPath` when the server runs under Bun) and to `cli.js`, because the macOS login environment doesn't have `~/.bun/bin` on its PATH.

### macOS: LaunchAgent

- File: `~/Library/LaunchAgents/com.tokenlarper.agent.plist`.
- Keys: `Label` = `com.tokenlarper.agent`; `ProgramArguments` = `[<bun>, <cli.js>, "--boot"]`; `RunAtLoad` = true; `AbandonProcessGroup` = true, so launchd doesn't kill the server when the launcher exits; `LimitLoadToSessionType` = `Aqua`, so it runs in the GUI session where the menu bar exists; `StandardOutPath` and `StandardErrorPath` both set to `login-agent.log` in the data folder.
- Enable: write the plist. It takes effect at the next login; nothing is loaded immediately.
- Disable: delete the plist. A `RunAtLoad` agent only runs when it is loaded at login, so there is nothing to unload, and `launchctl bootout` could signal the server that is running now.
- Status: enabled when the plist exists, its `ProgramArguments` point at this copy's `cli.js`, **and** the label isn't in `launchctl print-disabled gui/<uid>`. If the plist exists but the label is disabled, Settings shows "Turned off in System Settings → General → Login Items", and the toggle reads off.
- macOS 13+ shows a "Background Items Added" notice the first time and lists the item under Login Items. That's expected and documented in the README.

### Linux: XDG autostart

- File: `$XDG_CONFIG_HOME/autostart/token-larper.desktop`, defaulting to `~/.config/autostart/`.
- Contents: `[Desktop Entry]`, `Type=Application`, `Name=Token Larper`, `Exec=<bun> <cli.js> --boot` with each argument quoted and escaped according to the Desktop Entry spec, `X-GNOME-Autostart-enabled=true`, `Terminal=false`.
- Enable: write the file. Disable: delete it.
- Status: enabled when the file exists, its `Exec` points at this copy's `cli.js`, and it isn't marked `Hidden=true` or `X-GNOME-Autostart-enabled=false`. Desktop session settings tools set those when a user turns the entry off; treat it like the macOS disabled case.

### Code layout

- `src/startup.ts` keeps `getStartupStatus`, `setStartupStatus` and `repointStartupIfStale`, and delegates OS-specific work to:
  - `src/startup/windows.ts`: today's registry code, moved without behavior changes.
  - `src/startup/macos.ts` and `src/startup/linux.ts`.
- Each module exports `readEntry()`, `writeEntry(command)` and `removeEntry()`, plus pure functions that build and parse the entry text (`buildPlist`/`parsePlistTarget`, `buildDesktopEntry`/`parseDesktopTarget`), so tests don't touch the file system.
- `repointStartupIfStale` runs on all three platforms. If the entry points at an older or deleted copy (a `bunx` update installs each version in its own cache folder), rewrite it to point at this copy. Same rule as Windows today.
- Repointing is skipped when TOKEN_LARPER_DATA_DIR is set or the app runs from a git checkout, and it also repairs an entry for this copy whose Bun binary no longer exists.

### API and Settings

- `StartupConfig` changes:
  - add `platform: "windows" | "macos" | "linux"`;
  - replace `registryValue` with `entry` (the command the entry runs, or null);
  - add `entryPath` (the registry key, plist path or `.desktop` path);
  - add `disabledBySystem: boolean` (the macOS Login Items / Linux `Hidden=true` case);
  - keep `launcherPath`.
  The dashboard and server ship together, and the tray reads only `bootEnabled` and `openBrowserOnBoot` from `/api/tray-status`, so nothing else depends on the old field.
- Settings text: "Starts with Windows", "Starts at login" (macOS and Linux), "Turned off in System Settings" (macOS) or "Turned off in your desktop's startup settings" (Linux), and "Manual launch". Diagnostics label the entry "Windows startup", "Login item" or "Autostart entry".
- The "Windows startup launcher is missing" check in `setStartupStatus` applies only on Windows; macOS and Linux check that `bin/cli.js` exists instead.
- A write failure returns HTTP 500 with the reason, which Settings already shows inline. The toggle no longer flips back silently.

### Tests

- Unit: plist and `.desktop` generation, including paths with spaces, quotes and non-ASCII characters; `XDG_CONFIG_HOME` handling; parsing the target path back out; the stale-entry decision.
- Manual (Ubuntu): turn it on, log out and back in, and the dashboard is up. Turn it off, and nothing starts.
- Manual (macOS, by testers): the same, plus turn it off in Login Items and Settings shows the disabled state.

## Part 2: macOS menu bar icon

### Helper

- Source: `native/macos/TokenLarperTray.swift`, a single AppKit file with no Xcode project.
- Build: `swiftc -O` for `arm64-apple-macos12` and `x86_64-apple-macos12`, `lipo` into one universal binary, `codesign -s -` (ad-hoc). Output: `bin/darwin/token-larper-tray`, listed in `package.json` `files` and git-ignored.
- `bun run build:tray-mac` runs the same steps for contributors on a Mac.
- The helper runs with `NSApplication.ActivationPolicy.accessory`, so it shows no Dock icon and no app menu.
- It needs no special permissions: no Accessibility, Screen Recording, Full Disk Access or notifications.

### Lifecycle (mirrors Windows)

- The server launches the helper as `token-larper-tray --port <port> --server-pid <pid>` from `src/tray/macos.ts`, and keeps its PID to stop it on shutdown.
- Every 5 seconds the helper checks the server PID is alive and exits if it isn't. Every third tick (15 seconds) it fetches `/api/tray-status`. It also refreshes right before showing the popover.
- **Quit Token Larper** posts to `/api/shutdown`, ends the server PID, removes the status item and exits.

### Icon and tooltip

- New endpoint `GET /api/tray-icon` returns the logo polygons from `src/client/logoMark.ts` (`flattenPath` of `LOGO_PATHS.t` and `LOGO_PATHS.flame`) in 64-unit coordinates, the same data the PowerShell script embeds.
- The helper fills them with even-odd rule into an `NSImage` sized for the menu bar, and sets `isTemplate = true` so macOS tints it for light and dark menu bars.
- Tooltip: `Token Larper: <shortTooltip>`.

### Left-click: popover

- An `NSPopover` with `.transient` behavior, anchored to the status item.
- Same content and layout as the Windows popup (300 × 222 points): title "Token Larper" and `levelText`; `todayCaptionText`; `todayTokensText` large and `todayCostText`; a 1-point divider in the theme's `border` color; "Last 7 days" with `weekText`; "All time" with `allTimeText`; an **Open dashboard** link and `updatedText`.
- Colors come from `theme` in `/api/tray-status`, with the same Pine dark defaults the PowerShell script uses. The system font replaces Segoe UI at matching sizes and weights.
- Esc closes, Enter opens the dashboard, and clicking outside dismisses.
- If the status request fails, it shows "Unavailable" and "--", as on Windows.

### Right-click or Ctrl-click: menu

Same items and order as Windows:

1. Token Larper Telemetry (disabled header)
2. `summaryText` (disabled)
3. separator
4. **Open Dashboard (http://localhost:<port>)**
5. Sync Harnesses Now (ccusage)
6. separator
7. Start at Login (check mark from `bootEnabled`; posts to `/api/startup`)
8. Auto-Open Browser at Login (check mark from `openBrowserOnBoot`)
9. separator
10. Quit Token Larper

### Differences from Windows

- **No "Token Larper Running" notice at start.** A system notification would make macOS ask for notification permission; the menu bar icon appearing serves the same purpose.
- **Sync feedback is shown in the menu.** Windows shows a balloon; on macOS the stats line reads "Syncing…" and then the new summary, for the same reason.
- "Start on Windows Boot" is labeled "Start at Login".

### Failure handling

- Helper missing (for example a git clone where nobody ran `build:tray-mac`): log `macOS tray helper not found at <path>; run bun run build:tray-mac`, and continue without the icon.
- Launch failure: log the error. If the binary has a `com.apple.quarantine` attribute, log one line explaining that macOS blocked an unverified file and that reinstalling with `bunx token-larper` avoids it. The attribute is never removed automatically.
- `NO_TRAY=1` skips the helper, as on Windows.

## Part 3: Linux tray

### Approach

- The server registers the tray itself over the D-Bus session bus, using `dbus-next` (pure JavaScript, no native code). There's no helper process, so the tray stops when the server stops.
- Status comes straight from `buildTrayStatus()`, refreshed every 15 seconds, so the text matches Windows and macOS exactly.

### First step: feasibility check

Before the rest of Part 3, prove on Ubuntu 24.04 that `dbus-next` works under Bun: register a StatusNotifierItem with a static icon and a one-item menu, and handle a click. If it doesn't work, stop and switch to a small Go helper launched like the macOS helper. That change of approach is reported for approval before continuing.

### Protocols

- **StatusNotifierItem** at `/StatusNotifierItem`, bus name `org.kde.StatusNotifierItem-<pid>-1`, registered with `org.kde.StatusNotifierWatcher`. Properties: `Category=ApplicationStatus`, `Id=token-larper`, `Title=Token Larper`, `Status=Active`, `ItemIsMenu=false`, `Menu=/MenuBar`, `ToolTip`, and the icon.
- **com.canonical.dbusmenu** at `/MenuBar`: `GetLayout`, `GetGroupProperties`, `Event`, `AboutToShow`, and `LayoutUpdated` / `ItemsPropertiesUpdated` signals when the stats or check marks change.
- **org.freedesktop.Notifications** for the stats "popup", with an `open` action and `replaces_id`, so a new notification replaces the previous one instead of stacking.

### Icon

- Rasterize the same logo polygons in TypeScript into `IconPixmap` (ARGB32, network byte order) at 22, 24, 32 and 48 px.
- Linux panels don't tint icons automatically. During the feasibility check, test a symbolic icon (`IconName` plus `IconThemePath` pointing to a shipped `token-larper-symbolic.svg`) on both desktops. If either doesn't recolor it, use a light glyph with a dark outline that reads on light and dark panels.

### Menu

The same items and order as Windows and macOS, plus **Show Usage** right after the stats line. On Ubuntu a left-click opens the menu, so the stats notification needs a menu entry there.

### Behavior by desktop

| Windows behavior | Ubuntu GNOME | KDE Plasma |
|---|---|---|
| Logo icon | ✅ | ✅ |
| Hover tooltip | ❌ (the extension shows none) | ✅ |
| Left-click stats popup | Left-click opens the menu; **Show Usage** posts the stats notification | Left-click (`Activate`) posts the stats notification |
| Right-click menu | ✅ | ✅ |
| "Token Larper Running" at start | ✅ notification | ✅ notification |
| "Token Larper Synced" after Sync | ✅ notification | ✅ notification |
| Quit stops server and tray | ✅ | ✅ |

The stats notification has title "Token Larper · <levelText>", a body with today, last 7 days and all time from the same `trayStatus` fields, and an **Open dashboard** action that runs `xdg-open http://localhost:<port>`.

### When there's no tray

- No `DBUS_SESSION_BUS_ADDRESS` (SSH, headless) or `NO_TRAY=1`: skip silently.
- No `org.kde.StatusNotifierWatcher` on the bus (plain GNOME without the extension): log one line explaining how to install the AppIndicator extension. Watch `NameOwnerChanged` and register when a watcher appears, so enabling the extension later shows the icon without a restart.
- Any D-Bus error: log it and keep the server running.

### Tests

- Unit: menu layout builder (ids, order, check states, enabled flags); polygon rasterizer (pixel spot checks); notification text.
- Manual: the checklist on Ubuntu 24.04 (the owner's VM) and KDE Plasma (VM or a friend).

## Part 4: Packaging, release and order of work

### Server tray layout

`src/tray.ts` becomes:

- `src/tray/index.ts`: `startSystemTray(port)` / `stopSystemTray()`, choosing by `process.platform`.
- `src/tray/windows.ts`: today's code, unchanged in behavior.
- `src/tray/macos.ts`: launches and stops the helper.
- `src/tray/linux.ts`: the D-Bus tray.

### CI (`ci.yml`)

- A new `macos` job on `macos-latest` builds the helper, then checks `lipo -archs` lists `x86_64 arm64` and `codesign --verify` passes.

### Release (`release.yml`)

- A `build-tray-mac` job on `macos-latest` builds and uploads the helper as an artifact. The publish job downloads it into `bin/darwin/` and fails if the file is missing.
- The workflow also runs on pushes to a `beta` branch. A version containing `-` (for example `1.13.0-beta.1`) publishes with `npm publish --tag beta` and creates the GitHub Release with `--prerelease`. Stable versions keep publishing to `latest` as today.
- Publishing a beta is an outward-facing step: each beta publish is confirmed with the repo owner first.

### Version comparison fix

`compareVersions` in `src/semver.ts` ignores anything after `-`, so a tester on `1.13.0-beta.1` would treat `1.13.0` as the same version and never be offered it. Change it to follow semver precedence: a prerelease sorts below the same version without a suffix, and prerelease identifiers compare numerically when numeric. The update check keeps reading the `latest` dist-tag (`src/updates.ts`), so `latest` users are never offered a beta.

### Dependency size

Before adding `dbus-next`, check its installed size including dependencies. If it adds more than about 1 MB, vendor only the parts the tray uses.

### Pull requests

Each PR is branched from `main`, bumps `package.json` and gets its own review.

| # | PR | Bump | Testing |
|---|---|---|---|
| 1 | Start-at-login for macOS and Linux, `--boot`, `StartupConfig` and Settings changes, `compareVersions` fix, README. Includes this spec. | minor | Owner on Ubuntu; macOS testers in the step 5 beta |
| 2 | Split `src/tray.ts` into `src/tray/`, no behavior change | patch | Owner on Windows: tray works exactly as before |
| 3 | Linux tray, starting with the feasibility check | minor | Owner on Ubuntu; KDE via VM or friend |
| 4 | macOS helper CI job and beta release channel | patch | CI |
| 5 | macOS menu bar helper, published as `@beta` first | minor | Friends with the macOS checklist; then merged to `main` |

### Docs

- README: a per-platform table (tray, popup, start-at-login), the macOS Login Items notice, the GNOME AppIndicator note, and a `systemd --user` example for headless Linux.
- `llms.txt`: platform support summary.

## Manual test checklists

### macOS (testers)

1. `bunx token-larper@beta`: the dashboard opens and the "t." icon appears in the menu bar, tinted correctly in light and dark mode.
2. Hover: the tooltip shows today's tokens and cost.
3. Left-click: the popover matches the Windows popup layout and the dashboard's theme. Esc closes it, Enter opens the dashboard, and clicking outside dismisses it.
4. Right-click: every menu item is present. Open Dashboard and Sync work, and the check marks match Settings.
5. Turn on Start at Login: macOS shows "Background Items Added". Restart the Mac, log in, and the icon and server are back.
6. Turn the item off in System Settings → Login Items: Settings in the dashboard shows "Turned off in System Settings".
7. Quit Token Larper: the icon disappears and `http://localhost:4269` stops responding.

### Linux (Ubuntu and KDE)

1. `bunx token-larper`: the icon appears in the top bar or panel, and a "Token Larper Running" notification shows.
2. Ubuntu: clicking opens the menu, and Show Usage posts the stats notification. KDE: left-click posts it, right-click opens the menu, and hovering shows the tooltip.
3. The notification's Open dashboard action opens the browser.
4. Sync shows "Token Larper Synced" with updated numbers.
5. Start at Login: log out and in, and it's running. Turned off, and it isn't.
6. Quit: the icon disappears and the server stops.

## Open questions

None blocking. Decisions made during design:

- Approach A: a Swift helper for macOS and an in-process D-Bus tray for Linux.
- Ad-hoc signing for macOS for now.
- Linux targets: Ubuntu GNOME and KDE Plasma.
- macOS testing by friends through `@beta`.
