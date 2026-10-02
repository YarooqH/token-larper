<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/logo-dark.svg">
    <img src="docs/media/logo-light.svg" alt="Token Larper logo" width="96" height="96">
  </picture>
</p>

<h1 align="center">Token Larper</h1>

<p align="center">
  See what your AI coding agents cost you, in one local dashboard.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/token-larper"><img src="https://img.shields.io/npm/v/token-larper?color=2f5a43" alt="npm version"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0078d4" alt="Windows, macOS, Linux">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#supported-harnesses-18-agents">Supported agents</a> ·
  <a href="#uninstalling">Uninstall</a> ·
  <a href="#troubleshooting--faq">FAQ</a>
</p>

Token Larper reads the session logs that Claude Code, Codex, Antigravity, GitHub Copilot CLI, OpenCode, and 13 other coding agents already write to your disk, and turns them into a dashboard at `localhost:4269`. Nothing about your usage leaves your machine. It runs on Windows, macOS, and Linux, and on Windows it also sits in the system tray.

It's built on top of [`ccusage`](https://github.com/ccusage/ccusage), which does the log parsing, token counting, and pricing. Token Larper adds the dashboard, the tray icon, project grouping, and the Hall of Larp.

## Quick start

You need [Bun](https://bun.sh) 1.1 or later ([install steps](#2-bun-runtime-v11)). Then:

```bash
npx token-larper
```

It starts in the background and opens the dashboard. Stop it with `npx token-larper stop`.

---

## Screenshots

The screens below use sample data. No local sessions or project names are included.

<video src="https://github.com/user-attachments/assets/104c8036-694e-474b-81e1-d33576f2cc30" controls playsinline poster="https://raw.githubusercontent.com/YarooqH/token-larper/main/docs/media/overview.jpg" width="820">
  <a href="docs/media/walkthrough.mp4">Watch the 20-second walkthrough</a>
</video>

| Usage breakdown | Projects |
| --- | --- |
| ![Usage chart and token mix](docs/media/usage-chart.jpg) | ![Sessions grouped by project](docs/media/projects.jpg) |

| Hall of Larp | Settings |
| --- | --- |
| ![Rank and badges](docs/media/rank.jpg) | ![Theme and startup settings](docs/media/settings.jpg) |

---

## Features

* **Private and offline**: No API keys and no proxy to set up. Two optional requests leave your machine, and neither sends anything about your usage: an update check that asks npm for the latest version number (turn it off in **Settings → Updates**), and a once-a-day download of OpenRouter's public model price list (set `TOKEN_LARPER_OFFLINE=1` to skip it).
* **18 agents, one total**: Every supported harness is detected automatically and counted together, with filters per tool, model, session, and project.
* **Subscription-aware**: Verified API costs are kept apart from the estimated **"LARP Value"**, the API price of tokens you used through a flat-rate plan like Claude Pro/Max, Copilot, or Antigravity. Estimates use [OpenRouter's](https://openrouter.ai/models) current list prices, so new models are priced without waiting for an update.
* **Hall of Larp**: Lifetime token burn, 14 achievements, an 11-tier rank ladder with rivals, and a 1200×630 share card.
* **Six styles, your colors**: Grove, Terminal, Paper, Brutal, Soft, and Mono each change fonts, corners, spacing, borders, and shadows. Pick a base color and an accent from presets or any custom color, or import a tweakcn/shadcn CSS theme.
* **Cross-platform**: The engine, scrapers, and dashboard behave the same on Windows, macOS (Apple Silicon and Intel), and Linux. The tray icon is Windows-only.

---
## Prerequisites

Before setting up Token Larper, ensure your machine meets the following requirements:

### 1. Operating System
Token Larper runs across all major operating systems:
* **Windows 10 / Windows 11** (64-bit x64 or ARM64):
  * Full web dashboard + native Windows System Tray widget (`t.` monogram with live hover stats & boot auto-start).
* **macOS** (12.0+ Monterey or later, Apple Silicon M-series or Intel x64):
  * Full web dashboard + all 18 harness scrapers. Launches via terminal or background daemon (`nohup` / LaunchAgent).
* **Linux** (Ubuntu, Debian, Fedora, Arch, etc., x64 or ARM64):
  * Full web dashboard + all 18 harness scrapers. Launches via terminal or `systemd --user`.

### 2. Bun Runtime (v1.1+)
Token Larper uses **[Bun](https://bun.sh)** for its ultra-fast JavaScript/TypeScript server, bundling, and process management.

To check if Bun is installed:
```bash
bun --version
```

If you do not have Bun installed:
* **macOS & Linux**:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
* **Windows (PowerShell)**:
  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
*(After installing Bun, restart your terminal so `bun` is available on your `PATH`.)*

### 3. Windows PowerShell 5.1+ (Windows Only)
* Required **only on Windows** to draw the DPI-aware notification area system tray icon.
* **Execution Policy**: If your system restricts PowerShell scripts, enable local execution:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```
*(On macOS and Linux, the server detects non-Windows platforms automatically and skips the Windows tray initialization).*

### 4. At Least One Supported AI Coding Harness
You should have at least one AI coding harness installed and used on your machine so there are session logs to index (e.g. `~/.claude/` for Claude Code, `~/.local/share/opencode/` for OpenCode, `~/.gemini/` for Gemini/Antigravity, etc.).

---

## Quick Setup & Installation

### Option 1: Instant 1-Line Run (Recommended)
You can run Token Larper instantly without cloning:
```bash
npx token-larper
# or
bunx token-larper
```
It starts in the background, opens the dashboard, and keeps running after you close the terminal. On Windows, quit it from the tray icon. On any platform:
```bash
bunx token-larper stop          # stop it
bunx token-larper --foreground  # run in the terminal with logs instead
bunx token-larper --help        # all options
```
The background server writes its output to `server.log` in the data folder.

---

### Option 2: Clone from Source

### Step 1: Get the Code
Clone the repository (or click **Code → Download ZIP** on GitHub and extract it):
```bash
git clone https://github.com/YarooqH/token-larper.git
cd token-larper
```

### Step 2: Install Dependencies
Install the required packages using Bun:
```bash
bun install
```

---

## Running Token Larper

### On Windows

#### Option A: Silent System Tray (Recommended)
Launches windowless directly into your Windows System Tray without keeping a command prompt open:
```powershell
bun run tray
```
> **Shortcut**: You can also simply **double-click** `Start-TokenLarper.vbs` in File Explorer!

* The **Burning t.** icon will appear in your notification tray.
* Hover over the icon to see your real-time token count and cost estimate.
* Left-click the icon for a compact usage popup with an **Open dashboard** button. Right-click it to sync or configure boot auto-start.

#### Option B: Terminal Mode (Logs & Development)
```powershell
bun start          # Standard terminal launch
bun run dev        # Live reload on changes
```

---

### On macOS & Linux

#### Option A: Background Daemon
Run the server detached in the background:
```bash
nohup bun start > /dev/null 2>&1 &
```

#### Option B: Foreground Terminal Mode
```bash
bun start          # Standard launch
bun run dev        # Live reload on changes
```

---

### Opening the Dashboard
Open your browser and navigate to:
👉 **[http://localhost:4269](http://localhost:4269)**

*(On Windows, left-click the **`t.`** tray icon and select **Open dashboard**, or choose **Open Dashboard** from its right-click menu.)*

---

### Stopping Token Larper
To cleanly stop the server:
* **From the CLI (All Platforms)**:
  ```bash
  npx token-larper stop   # or, from a clone: bun run stop
  ```
  *(Sends a graceful shutdown request to the local API on port 4269. If you changed the port, set `PORT` the same way first.)*
* **From the Windows Tray**: Right-click the **`t.`** icon → Select **Quit Token Larper**.

---

## Uninstalling

Token Larper only reads your agents' logs, so removing it leaves your session history untouched. Do the steps in this order: the Windows startup entry points at the app folder, so turn it off before you delete anything.

### 1. Turn off startup and stop it

On Windows, if you turned on **Start with Windows**, turn it off in the dashboard under **Settings**, or right-click the tray icon and uncheck **Start on Windows Boot**. Then quit from the tray, or run:

```bash
npx token-larper stop
```

If you already deleted the app and it still launches at login, remove the startup entry by hand:

```powershell
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v TokenLarper /f
```

On macOS and Linux, stopping it is enough. If you set up your own LaunchAgent or `systemd --user` unit for it, remove that too.

### 2. Delete the data folder

This holds settings, caches, the downloaded price list, and `server.log`:

| OS | Folder | Remove it with |
| :--- | :--- | :--- |
| Windows | `%LOCALAPPDATA%\TokenLarper` | `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\TokenLarper"` |
| macOS | `~/Library/Application Support/TokenLarper` | `rm -rf ~/Library/Application\ Support/TokenLarper` |
| Linux | `~/.local/share/token-larper` | `rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/token-larper"` |

If you set `TOKEN_LARPER_DATA_DIR`, delete that folder instead.

### 3. Remove the app

* **Ran it with `npx` or `bunx`**: Nothing was installed globally. The package sits in the npx or Bun cache, and it's fine to leave it there. To get the space back, delete npx's cache folder (`~/.npm/_npx`, or `%LOCALAPPDATA%\npm-cache\_npx` on Windows) or run `bun pm cache rm`. Both clear every cached package, not only this one; the others download again the next time you use them.
* **Installed it globally**: `npm uninstall -g token-larper` or `bun remove -g token-larper`.
* **Cloned from git**: Delete the folder. Versions before 1.5.0 kept their data in `.cache` inside it, so that goes too.

Bun stays installed. If you only installed it for Token Larper, see [Bun's uninstall steps](https://bun.sh/docs/installation#uninstall).

---

## Supported Harnesses (18 Agents)

Token Larper utilizes `ccusage` v20+ paired with native deep scanners to automatically detect and index session history across 18 coding environments:

| Harness | Vendor | Default Local Path Scanned |
| :--- | :--- | :--- |
| **Claude Code** | Anthropic | `~/.claude/` & `~/.claude.json` |
| **Antigravity** | Google DeepMind | `%APPDATA%\antigravity-ide\` & `~/.gemini/` |
| **Codex CLI** | OpenAI | `~/.codex/` |
| **GitHub Copilot CLI** | GitHub / Microsoft | `~/.copilot-cli/` & `%LOCALAPPDATA%\GitHubCopilot` |
| **Gemini CLI** | Google | `~/.gemini/` |
| **OpenCode** | OpenCode | `~/.local/share/opencode/` & `%APPDATA%\opencode` |
| **pi-agent** | Pi | `~/.pi/` & `~/.pi-agent/` |
| **Goose** | Block | `~/.goose/` |
| **Hermes** | Hermes AI | `~/.hermes/` |
| **Amp** | Ampersand | `~/.amp/` |
| **Droid** | Factory | `~/.droid/` |
| **Codebuff** | Codebuff | `~/.codebuff/` |
| **Kilo** | Kilo | `~/.kilo/` |
| **Kimi** | Moonshot | `~/.kimi/` |
| **Qwen** | Alibaba | `~/.qwen/` |
| **OpenClaw** | OpenClaw | `~/.openclaw/` |
| **Grok** | xAI | `~/.grok/` |
| **ZCode** | ZCode | `~/.zcode/` |

---

## Configuration & Features

### Auto-Start on Windows Boot
You can have Token Larper launch silently into the system tray every time you turn on your computer:
1. Right-click the **`t.`** system tray icon.
2. Click **Start on Windows Boot** to enable it.
3. *(Optional)* Click **Auto-Open Browser on Boot** if you want your default browser to launch directly to the dashboard upon login.

*(This registers a clean user entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\TokenLarper` running the windowless launcher).*

### Custom Port
By default, Token Larper runs on port `4269`. You can specify a custom port:
* **macOS & Linux**:
  ```bash
  PORT=5000 bun start
  ```
* **Windows (PowerShell)**:
  ```powershell
  $env:PORT = "5000"; bun start
  ```
The port is also persisted in `settings.json` in the data folder (see below).

### Data Folder
Caches and settings live outside the app folder, so updates keep them:

* **Windows**: `%LOCALAPPDATA%\TokenLarper`
* **macOS**: `~/Library/Application Support/TokenLarper`
* **Linux**: `$XDG_DATA_HOME/token-larper` (default `~/.local/share/token-larper`)

Set `TOKEN_LARPER_DATA_DIR` to use another folder. Versions before 1.5.0 kept this data in `.cache` inside the app; it is copied over on first run.

### Updates
When a new version is on npm, the dashboard shows a banner. **Update now** starts `bunx token-larper@latest` in the background; the new version replaces the running one on the same port and the dashboard reloads. You can also check from **Settings → Updates**, or turn automatic checks off there. A copy cloned from git updates with `git pull`.

### Estimated Prices
When ccusage has no price for a model (a brand-new one, or usage through a flat-rate subscription), Token Larper estimates the cost from list prices. It downloads OpenRouter's public model price list once a day, keeps it in the data folder as `openrouter-pricing.json`, and prices any model on that list from it. Other models use rates built into the app. Only the price list is downloaded; nothing about your usage is sent, and if the download fails the last saved list is used.

Estimates do not include OpenRouter's long-context surcharges, and a model name that OpenRouter spells differently may fall back to the built-in rates. Verified costs from ccusage are never changed. Set `TOKEN_LARPER_OFFLINE=1` to skip the download and use only the saved list (if any) and the built-in rates.

### Headless Server Mode
If running on a remote headless server or Docker container, you can explicitly disable the tray icon (automatically disabled on macOS/Linux):
```bash
NO_TRAY=1 bun start
```

---

## Comparison with Alternatives

| Dimension / Feature | Token Larper | LiteLLM / Portkey | Langfuse / Arize | `ccusage` CLI |
| :--- | :---: | :---: | :---: | :---: |
| **Telemetry Ingestion** | Passive local disk log scraping | HTTP Reverse Proxy | SDK / OTel Collector | Passive local disk log scraping |
| **Setup Complexity** | Zero-config (`npx token-larper`) | High (custom proxy URLs) | High (SDK instrumenting) | Low (`npm i -g ccusage`) |
| **Supports Flat Subscriptions (Pro/Max)** | ✅ Yes (Estimates LARP value) | ❌ No | ❌ No | ✅ Yes |
| **User Interface** | Interactive Web + Native Tray | Cloud / Docker Web UI | Cloud / Self-hosted UI | Terminal tables only |
| **Agent Auto-Detection** | ✅ 18+ coding harnesses | ❌ Manual per-tool proxy setup | ❌ Manual code changes | ✅ 18+ coding harnesses |
| **100% Offline & Private** | ✅ Yes (Zero cloud telemetry) | ⚠️ Depends on deployment | ⚠️ Cloud or self-hosted DB | ✅ Yes |
| **Gamification & Shareable Cards** | ✅ Yes (Hall of Larp) | ❌ No | ❌ No | ❌ No |

---

## Hall of Larp (Rank & Gamification)

Token Larper includes a dedicated **Rank** view designed to celebrate your token burn:
* **11 Lifetime Tiers**: Progress from *Script Larper* (0 tokens) to *Deity of the Infinite Context Window* (1B+ tokens).
* **Rival Leaderboards**: Compete against quirky procedural AI rivals as your token count climbs.
* **14 Achievements**: Unlock badges for late-night hacking sessions, burning $100+ in a single day, or harnessing 5+ different agents.
* **Shareable Rank Card**: Generate and export a 1200×630 PNG badge to share on X/Twitter or Discord. Project paths and names are strictly sanitized and never included.

---

## Troubleshooting & FAQ

### 1. How do I monitor Claude Code token usage and spend locally?
Token Larper automatically scans `~/.claude/` for Claude Code session files and SQLite databases. It displays daily, weekly, and monthly token burns (input, output, cache creation, cache read) alongside verified costs without requiring Anthropic API keys.

### 2. Can I track tokens across multiple tools like Antigravity, Claude Code, and Codex in one place?
Yes. Token Larper detects and aggregates usage across 18 supported coding harnesses simultaneously, allowing you to see your cross-agent total spend and filter by specific tools.

### 3. Why track local agent logs instead of using a reverse proxy like LiteLLM?
Many modern coding agents (Claude Code, GitHub Copilot CLI, Antigravity) use OAuth subscriptions rather than raw pay-per-token API keys. Proxies cannot intercept or track these subscription agents without TLS decryption and custom protocol reverse-engineering. Token Larper solves this by reading the session logs the agents write directly to your local drive.

### 4. `'bun' is not recognized as an internal or external command`
* **Cause**: Bun was installed, but the current terminal session doesn't have `%USERPROFILE%\.bun\bin` in its `PATH`.
* **Fix**: Close and reopen your terminal, or manually add it for your session:
  ```powershell
  $env:PATH += ";$env:USERPROFILE\.bun\bin"
  ```

### 5. `cannot be loaded because running scripts is disabled on this system`
* **Cause**: Windows PowerShell default execution policy is preventing local scripts from running.
* **Fix**: Open PowerShell as your standard user and run:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```

### 6. The system tray icon is not visible
* **Cause**: Windows may have placed the icon inside the "hidden notification icons" overflow menu (the `^` arrow on the taskbar).
* **Fix**: Click the `^` arrow next to your Windows clock, find the **Burning t.** icon, and drag it onto your main taskbar to keep it permanently visible.

### 7. No tokens or sessions are showing up in the dashboard
* **Cause**: Either no coding agents have been executed yet, or their logs are located in non-standard directories.
* **Fix**: 
  1. Run a quick session with one of your tools (e.g., `claude` or `antigravity`).
  2. Right-click the system tray icon and click **Sync Harnesses Now (ccusage)**, or click the **Sync Now** button in the top right of the dashboard.

### 8. Port 4269 is already in use
* **Fix**: Token Larper might already be running in the background. Stop it using:
  ```powershell
  bun run stop
  ```
  Or change the port:
  ```powershell
  $env:PORT = "4500"
  bun start
  ```

---

## Project Architecture

```
tokenlarper/
├── Start-TokenLarper.vbs      # Windowless silent launcher for Windows
├── package.json              # Scripts & dependencies
├── scripts/
│   ├── run-server.ps1        # PowerShell background watchdog & port resolver
│   ├── launch-silent.vbs     # VBS helper for boot auto-start
│   ├── tray-host.ps1         # Native DPI-aware Windows Forms system tray host
│   └── launch-on-default-desktop.ps1 # WinSta0\Default desktop trampoline
├── src/
│   ├── server.ts             # Bun HTTP & WebSocket server + client bundler
│   ├── ccusage.ts            # 18-harness telemetry reader & cost calculation engine
│   ├── tray.ts               # System tray lifecycle management & IPC
│   ├── startup.ts            # Windows registry boot integration
│   ├── projects.ts           # Workspace & Git repository deduplication
│   ├── types.ts              # TypeScript interfaces & data contracts
│   └── client/               # React 19 Frontend Dashboard
│       ├── App.tsx           # Layout, navigation, date ranges, and global state
│       ├── charts.tsx        # Stacked SVG bar & trend charts
│       ├── views/            # Overview, Tools, Models, Sessions, Projects, Rank
│       └── styles.css        # Custom responsive CSS design system (Dark/Light)
```

---

## Acknowledgments & Credits

Token Larper is built directly on top of the work of the open-source community:
* **[`ccusage`](https://github.com/ccusage/ccusage)** — The core telemetry engine powering local session scraping, token counting, and cost calculations across AI coding harnesses.
* **[Bun](https://bun.sh)** — Fast all-in-one JavaScript runtime and bundler.
* **[Lucide Icons](https://lucide.dev)** — Clean and consistent iconography for the web dashboard.

---

## License

MIT © Token Larper Contributors
