# Token Larper video plan

For review before anything is recorded. Three pieces, all cut from one recording session:

| Video | Length | Format | Used on |
| --- | --- | --- | --- |
| **A. Hero video** | 40–45 s | 16:9, 1080p (also a 1:1 crop) | Reddit (native upload), X launch thread, README, Product Hunt, HN site |
| **B. Shorts series** | 15–25 s each, 4 videos | 9:16, 1080×1920 | YouTube Shorts, TikTok, Reels, X |
| **C. Walkthrough** | 2–3 min | 16:9, 1080p | YouTube, Product Hunt, linked from the README |

The README's current 20-second walkthrough can stay until A replaces it.

---

## Ground rules for every video

- **The first two seconds are the hook.** Most people decide by then. Open on the number or the question, never on a logo or a title card.
- **Burned-in captions.** Most feeds play muted. Every spoken line or key point appears as on-screen text.
- **No real projects.** Record from sample data, or from real data with **Screenshot mode** on (Settings → Privacy), which shows Project A, Project B. Check every frame for paths, usernames, and tab titles before export.
- **One idea per shot.** Zoom or crop to the part of the screen that matters. A full dashboard at phone size is unreadable.
- **Pick one style for the whole video.** Grove (default) or Terminal read best on video. Dark mode for X and Reddit, which most people browse in dark.
- **End with the command, not the logo:** `bunx token-larper` plus the GitHub URL, on screen for at least 3 seconds.
- **Music:** quiet, royalty-free, no lyrics. Optional for A, recommended for B, none under the voice in C.

---

## Before recording

1. **Sample data for every screen.** `scripts/docs-demo-server.ts` only serves `/api/usage`. Limits (`/api/limits`), Live mode (`/api/live`), and model speed (`/api/throughput`) return 404 there, so those screens come up empty. Either:
   - extend the demo server with sample Limits readings (Claude 5-hour at ~62%, weekly at ~40%, Codex, Copilot, Antigravity cards), sample speed figures, and a sample Live feed that emits responses every second or two, **or**
   - record those screens from real use with Screenshot mode on, while two or three agents are actually working.

   The first is cleaner and repeatable for future videos. I can build it once you approve this plan.
2. **Pick believable numbers.** A Max plan user with a LARP value around $2,000–4,000 a month is believable and impressive. Very large numbers read as fake.
3. **Browser:** a clean profile, no bookmarks bar or extensions, window at 1920×1080, page zoom at 110–125% so text holds up when cropped.
4. **Terminal:** large font (18–20 pt), simple prompt, dark theme matching the dashboard.
5. **Recording tool:** OBS (free, any OS), or Screen Studio / Cap if you want automatic cursor zooms. Record at 60 fps so Live mode's motion is smooth.

---

## A. Hero video (40–45 s)

Fast cuts, captions do the talking, no voiceover needed (optional VO script on the right).

| Time | On screen | Caption / text overlay | Optional VO |
| --- | --- | --- | --- |
| 0:00–0:03 | Close-up of the Overview cost card counting up to the LARP value (e.g. $3,412) while the plan cost ($200) sits beside it | **"I pay $200 a month for Claude. I used $3,412."** | "I pay two hundred a month for Claude. Here's what I actually used." |
| 0:03–0:07 | Terminal: type `bunx token-larper`, press Enter, browser opens to the dashboard | **One command. No API keys. No proxy.** | "One command, nothing to set up." |
| 0:07–0:13 | Overview: pan across tokens, cost, token mix chart. Click the tool filter to show Claude Code, Codex, Copilot together | **Every agent you use, in one place.** | "It finds every coding agent on your machine." |
| 0:13–0:20 | Limits tab: zoom on the Claude 5-hour bar and weekly bar with reset times, then pan to the Codex and Copilot cards | **How much of your limit is left, and when it resets.** | "And shows how much of each plan is left." |
| 0:20–0:28 | Live mode: tokens-per-minute trace rising, ticks landing on the tape, a session's context size updating | **Live, every second.** | "Live, while your agents work." |
| 0:28–0:32 | Models tab: Speed column and speed-over-time chart, hover a value to show median and p90 | **Which model is actually fastest for you.** | — |
| 0:32–0:37 | Stats tab: streak flame lights, rank row fills, "Next rival: A Discord bot with feelings", then the share card | **Streaks, ranks, rivals.** | "Plus streaks, if you're competitive." |
| 0:37–0:40 | Privacy settings: the network table, Offline mode switch | **Runs locally. No telemetry.** | "Nothing leaves your machine." |
| 0:40–0:45 | End card: logo, `bunx token-larper`, `github.com/YarooqH/token-larper`, "Free · MIT · Windows, macOS, Linux" | (same) | "Token Larper. Free and open source." |

**1:1 crop for X and Reddit mobile:** the same edit, reframed shot by shot around the focal element. Don't letterbox the 16:9.

---

## B. Shorts series (9:16, 15–25 s each)

Each Short is built around one question, the kind people search for. Vertical framing means one panel at a time, zoomed in.

**B1. "What's my Claude plan actually worth?"** (the strongest one, post first)
- 0–2 s: text over a blurred dashboard: *"What is my $200 Claude plan actually worth?"*
- 2–6 s: terminal, `bunx token-larper`.
- 6–14 s: cost card, Verified toggled to Estimate, number counts up. Zoom on the LARP value.
- 14–18 s: Models tab price list, "priced from OpenRouter's list prices".
- 18–22 s: end card with the command.

**B2. "How much of my Claude limit is left?"**
- 0–2 s: *"Hit your Claude limit again?"*
- 2–14 s: Limits tab, 5-hour then weekly window, reset countdown, per-model weekly limit.
- 14–18 s: Codex and Copilot cards: *"Codex and Copilot too."*
- 18–22 s: end card.

**B3. "Watching three AI agents burn tokens live"**
- 0–2 s: Live mode already moving, caption *"3 agents, live."*
- 2–16 s: the trace stacking by tool, the tape filling, burn rate in $/hour.
- 16–20 s: end card.

**B4. "My AI coding rank"** (the fun one)
- 0–2 s: *"I just beat 'A Discord bot with feelings'."*
- 2–12 s: Stats tab, streak with a freeze, rank progress, rivals list scroll (the blurbs are the jokes, give them time to read).
- 12–16 s: share card.
- 16–20 s: *"What's your rank?"* + command.

---

## C. Walkthrough (2–3 min, with voiceover)

Calm pace, voiceover throughout, cursor visible. Chapters in the YouTube description.

| Chapter | Time | Content |
| --- | --- | --- |
| Why | 0:00–0:15 | The problem: subscription agents hide what you use and how close you are to the limit. Show the LARP value as the cold open. |
| Install | 0:15–0:35 | Install Bun (one line), `bunx token-larper`, dashboard opens. Mention the Windows tray icon. |
| Overview | 0:35–1:00 | Date range, tool filter, Verified vs Estimate costs, Quota strip. |
| Limits | 1:00–1:25 | Each vendor's windows, reset times, multiple accounts, stale readings, Offline mode fallback. |
| Live mode | 1:25–1:50 | Tokens per minute, tape, by tool and model, sessions with context size. |
| Tools, Models, Projects, Sessions | 1:50–2:20 | Speed per model, speed over time, sessions grouped by repo. |
| Hall of Larp | 2:20–2:35 | Streak, freezes, rank, rivals, share card. |
| Privacy and styles | 2:35–2:50 | The network table, Offline mode, Screenshot mode, the six styles. |
| Outro | 2:50–3:00 | Command, GitHub link, "tell me which agent I'm missing". |

---

## Decisions for you

1. **Voiceover or captions only** for the hero video? Captions-only is faster to make and works muted. A voice adds personality, which helps on Reddit.
2. **Your face on camera** for the walkthrough? Not needed, but a 5-second intro raises trust on YouTube.
3. **Sample data:** shall I extend the demo server with Limits and Live data so every screen can be recorded without real usage?
4. **Which numbers to show:** sample figures as above, or your real ones with Screenshot mode on? Real numbers make the post more believable ("these are mine"), as long as you're comfortable sharing them.
