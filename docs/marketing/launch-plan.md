# Token Larper launch and marketing plan

Written October 2026. Starting point: the repo went public on 27 September 2026 and has 1 star. The product is mature (v1.25, 18 agents, Limits, Live mode, Hall of Larp), so the problem is that nobody knows it exists, not that it isn't ready.

The video is planned separately in [video-plan.md](video-plan.md) for review before anything is recorded.

---

## 1. What we're selling, in one breath

**Call it a tool or a dashboard, not an extension.** It isn't installed from the VS Code or Chrome store. People who read "extension" go looking for it there, don't find it, and leave.

**One-liner:**
> See what your AI coding agents really cost, and how much of your plan is left. One command, runs locally, 18 agents.

**The three hooks, in order of pull:**

1. **"What is my $200 plan actually worth?"** The LARP Value (API price of tokens used on a flat-rate plan) is the most shareable number in the app. People already post "I used $X,000 of tokens on a $200 plan" on Reddit and dev.to with screenshots from ad-hoc scripts. We give them a nicer screenshot and a reason to post it.
2. **"How much of my limit is left, and when does it reset?"** Since the 5-hour and weekly windows arrived, this is a daily question for Claude Code and Codex users. The Limits tab answers it for Claude, Codex, Copilot, Antigravity, and OpenCode Go side by side. Few tools do multiple vendors.
3. **"All my agents in one place."** Most people now run two or three agents. Most competing tools are Claude-only (ccboard, claumon, CCDash, Tokemon) or terminal-only (ccusage).

**Supporting points** (use in comments and FAQs, not headlines): no telemetry and nothing leaves the machine, no proxy or API keys, ~5 MB with no Electron, Live mode, model speed, streaks and badges.

**Who it's for, ranked:**

| Audience | Why they care | Where they are |
| --- | --- | --- |
| Claude Pro/Max users on Claude Code | Limits, LARP value | r/ClaudeAI, r/ClaudeCode, X |
| Codex users on ChatGPT plans | Limits, cost | r/codex, r/OpenAI, X |
| People running several agents | One dashboard | r/ChatGPTCoding, r/vibecoding, HN |
| Copilot CLI and Antigravity users | Quota visibility | r/GithubCopilot, Antigravity communities |
| Team leads watching spend | Per-project cost | LinkedIn, HN, newsletters |

**Don't target Cursor or Windsurf users.** Those editors aren't in the supported list, and a post there will get "doesn't work with Cursor" as the top comment.

---

## 2. Fix before launching (week 0)

Launch traffic is a one-time spike. Anything that loses people between "click" and "dashboard open" should be fixed first. In order of impact:

1. **The Bun requirement.** Most visitors have Node, not Bun. `npx token-larper` prints install instructions and stops, and most people won't come back after installing a runtime. Options, best first:
   - Ship standalone binaries (`bun build --compile`) on GitHub Releases, plus a one-line installer script.
   - Or have the CLI offer to install Bun itself ("Bun isn't installed. Install it now? [Y/n]").
   - At minimum, every post shows the Bun install line next to `bunx token-larper`, so nobody is surprised.
2. **Put the install command on the share card.** The 1200×630 card says "Token Larper" but has no URL or command, so each share is a dead end. Add a footer: `bunx token-larper · github.com/YarooqH/token-larper`. This is the built-in growth loop, and right now it's switched off.
3. **One-click share.** Next to "Download share card", add "Post to X" and "Post to Bluesky" links with prefilled text, for example: *"My $200 Claude plan used $3,412 of API tokens this month. Rank: Heavy User. bunx token-larper"*. The number in the text is what gets clicks.
4. **GitHub repo polish:**
   - A social preview image (Settings → Social preview, 1280×640). It's what shows when the link is pasted on X, Discord, Slack, and LinkedIn. The share card style works.
   - A 6–8 second looping GIF at the top of the README. The `<video>` tag plays on github.com but not on npm, in many link previews, or in RSS readers.
   - Repo description and topics matching the npm keywords: `claude-code`, `codex`, `copilot`, `token-usage`, `ai-coding`, `llm-cost`, `dashboard`, `local-first`.
   - A release note for the current version written for humans ("What Token Larper does"), so the Releases page reads like a launch.
   - Turn on GitHub Discussions, so feedback has a home that isn't an issue.
5. **A demo build of Limits, Live mode, and speed.** `scripts/docs-demo-server.ts` serves sample data for `/api/usage` only. The Limits, Live, and speed screens are the best-looking parts of the app and need sample data too, both for the video and for screenshots without anyone's real projects in them. See the video plan.
6. **Optional: a one-page site.** A GitHub Pages page on a short domain (check what's available) gives HN and Product Hunt a cleaner link and gives search engines a page to rank. Not required for week 1.

Don't buy stars or upvotes and don't organise upvote rings. Reddit shadow-bans for it, HN's voting-ring detection kills the post, and GitHub removes fake stars. Asking friends to *try it and leave honest feedback* is fine.

---

## 3. Channels

Ranked by expected return for this audience. Rules change often, so **read each subreddit's sidebar and rules the day you post**. Notes below are what I could confirm, plus what's typical.

### 3.1 Reddit (biggest lever)

**General rules that apply everywhere:**

- **Account first.** Use a personal account with real history. r/ClaudeAI requires at least 50 total karma to post a showcase on the main feed (mod post, April 2026); below that you're sent to the "Built with Claude" showcase megathread, and its Rule 7 sets the showcase requirements. Spend week 0 answering questions in r/ClaudeCode and r/ClaudeAI to earn karma honestly. It also teaches you what people are asking.
- **Say you built it.** "I built…" in the title or first line. Hidden self-promotion gets removed and the account gets remembered.
- **Lead with the problem or a number, not the product name.** "I got tired of not knowing how much of my weekly limit was left, so I built a local dashboard" works. "Introducing Token Larper" doesn't.
- **Upload the video natively.** Reddit-hosted video autoplays in the feed, while outbound links get far less engagement. Put the GitHub link in the post body, or in the first comment where the sub requires that.
- **Post Tuesday–Thursday, 8–10am US Eastern.** Stay for the first two hours and reply to every comment. Early comment activity drives ranking more than anything else.
- **One sub per day, not a crosspost blast.** Write a different title and opening for each sub. Identical posts across subs within hours look like spam to both mods and Reddit's filters.
- **Treat criticism as material.** "Does it support X?" means a feature request or a README FAQ. "Why Bun?" means section 2.1 matters.

**Subreddits, in posting order:**

| # | Subreddit | Angle | Notes |
| --- | --- | --- | --- |
| 1 | r/ClaudeCode | Limits tab plus LARP Value for Claude Code | Core audience, smaller and friendlier than r/ClaudeAI. Soft launch here. |
| 2 | r/ClaudeAI | "What my Max plan was actually worth" with a screenshot | Largest audience. Needs 50+ karma for the main feed. Use the Showcase flair and check Rule 7. |
| 3 | r/codex | Codex 5-hour and weekly windows, credits | Lead with Codex screenshots, not Claude. |
| 4 | r/ChatGPTCoding | Multi-agent: one dashboard for Claude Code, Codex, Copilot | Despite the name, it covers all AI coding tools. |
| 5 | r/vibecoding | LARP Value and Hall of Larp (streaks, rivals) | The fun angle lands here. |
| 6 | r/GithubCopilot | Copilot CLI premium requests and quota | Only if Copilot screenshots are strong. |
| 7 | r/SideProject | Build story: why and how | Allows self-promo. Low traffic but easy. |
| 8 | r/opensource | MIT, local-first, built on ccusage | Stress the license and that there's no telemetry. |
| 9 | r/bun | "Built entirely on Bun, ~5 MB, no Electron" | Small, but Bun people share Bun projects. |
| 10 | r/webdev | Only in the Showoff Saturday thread | Self-promo outside that thread gets removed. |

Also check whether active Antigravity, OpenCode, and Gemini CLI subreddits exist when you launch. Communities for newer tools come and go, and their users have the fewest alternatives, so a working tool means more to them.

**Skip:** r/programming (bans self-promo), r/LocalLLaMA (the tool tracks cloud agents, and the community is hostile to anything that looks cloud-first), r/cursor (not supported).

**Ongoing, after launch, and more valuable than the launch posts:**

- Set up free keyword alerts with **F5Bot** (emails you when Reddit or HN mention a word) for: `ccusage`, `weekly limit`, `usage limit`, `token usage`, `how much of my limit`, `Max plan worth`, `Codex limit`.
- When someone asks "how do I see how much of my limit is left?", answer the question first, then add "I built a tool for this, disclosure: it's mine" with the link. One helpful reply in the right thread converts better than a launch post.
- Every time a vendor changes limits or pricing, threads fill with people asking exactly what the Limits tab answers. Be in those threads within hours.

### 3.2 Hacker News: Show HN

HN likes local-first, no telemetry, and a clever technical insight. We have all three.

- **Title:** `Show HN: Token Larper – local dashboard for Claude Code, Codex and Copilot usage`. Plain and descriptive, no adjectives, no emoji.
- **Link** to the GitHub repo (or the one-page site, if built).
- **First comment, by you, right away:** why you built it, the insight that subscription agents sign in with OAuth so a proxy like LiteLLM can't see their traffic but the agents already write every response to disk, what's local, the one network table from the README, credit to ccusage, and what you'd like feedback on.
- **Timing:** Tuesday–Thursday, around 8–9am US Eastern.
- Never ask anyone to upvote. If it doesn't take off, you may repost once after a few weeks with a meaningfully different version. The HN mods also email some good Show HNs inviting them to the second-chance pool.
- Expect the questions "why Bun?", "why not just ccusage?", and "is the quota endpoint allowed?". Have short, honest answers ready, and point to the README's comparison table and Limits caveats.

### 3.3 X / Twitter

Most AI-coding chatter happens here, including people from Anthropic, OpenAI, and the agent makers.

- **Launch thread:** the hero video in the first post, then one post per hook (LARP Value, Limits, Live mode, Hall of Larp), and the install command plus link in the last post.
- **Build in public:** post 3–4 times a week. Small feature GIFs, a "this week's LARP value" screenshot, release notes. Consistency matters more than any single post.
- **Reply, don't broadcast.** When a big account posts about hitting a Claude or Codex limit, a short reply with a Limits-tab screenshot ("this is how I keep track, built a free local tool for it") gets more views than your own posts at 0 followers.
- **ccusage.** Token Larper is built on ccusage and credits it. Tell its maintainer about the project, thank them, and ask whether they'd list it among related projects. A share from them reaches exactly the right audience. Ask once, politely, with no pressure.
- Tag the agent makers (OpenCode, Pi, Amp, Goose, Kilo, and the others) when they're supported. Smaller projects often reshare tools that support them.

### 3.4 Product Hunt

Launch in week 3, once Reddit and HN have shaken out the bugs and you have real user quotes.

- Launch 12:01am Pacific, Tuesday–Thursday.
- Assets: a 240×240 icon (logo mark), a 1270×760 gallery (hero shot, Limits, Live, Hall of Larp, share card), the hero video, and a short maker comment.
- Tagline (60 characters max): *"See what your AI coding agents really cost, locally."*
- Tell the people who already starred or commented that it's live. That's fine. Asking for upvotes isn't.
- Product Hunt alone won't make dev tools take off, but the badge and backlink help, and it feeds newsletters.

### 3.5 Written content (search traffic that keeps working)

People search exactly these questions, and the README FAQ and `llms.txt` already cover several. Turn each into a standalone post on dev.to and Hashnode (and Medium if you like) with a canonical link:

1. **"I tracked every token my AI agents used for 30 days. Here's what my $200 plan was really worth."** Real numbers, charts from the app, the split between models, cache-read share. Data posts get shared.
2. **"How to see how much of your Claude Code weekly limit is left"**, a how-to that ranks for the search.
3. **"Claude Code vs Codex vs Copilot CLI: what each one cost me in a month"**, a comparison post that draws all three audiences.
4. **"Which model is actually fastest for me? Output speed from my own session logs"**, using the Speed tab. Benchmarks start arguments, and arguments spread.
5. **"Why I read log files instead of proxying API traffic"**, the technical post for HN and the Bun crowd.

### 3.6 Newsletters, lists, and directories

One-time submissions that keep sending trickle traffic:

- **Awesome lists:** open a PR to `awesome-claude-code` and to any awesome lists for Codex, AI agents, and Bun. Follow each list's contribution format exactly.
- **Newsletters with submission forms:** Console.dev (open-source dev tools), TLDR (AI and Web Dev editions), Changelog News, JavaScript Weekly and Bytes (the Bun angle). Check each one's current submission process.
- **Directories:** AlternativeTo (as an alternative to ccusage, LiteLLM, and Langfuse), and the "awesome AI tools" style directories that index GitHub projects.
- **The agent makers' docs and Discords.** Many have a showcase or community-tools channel (Bun's Discord has one, and OpenCode's community is active). Post once in each, in the channel meant for it.

### 3.7 YouTube and short video

- **Your own channel:** the hero video, the 2–3 minute walkthrough, and the Shorts series from the video plan. Shorts are cheap to make and get found through search.
- **Creators:** AI-coding YouTubers with 5k–100k subscribers reply to email far more than the big ones and have the right viewers. Send a short note: what it does, one GIF, the install line, and an offer to answer questions. No payment needed; many are looking for tools to show. Send 10–15, expect 1–3 to cover it.
- **TikTok and Instagram Reels:** post the same vertical cuts as the Shorts. It costs nothing extra, and dev content on TikTok gets reach with almost no followers.

### 3.8 LinkedIn

Lower priority, but good for the team-lead angle: "how much is your team's AI coding actually costing?" with the Projects tab. One post at launch, one when you publish the 30-day data post.

---

## 4. Timeline

| Week | Focus | Concrete actions |
| --- | --- | --- |
| **0** (prep) | Remove friction, build assets | Fixes from section 2 (at least the share-card footer and repo polish). Extend the demo server. Record the video. Earn Reddit karma by helping in r/ClaudeCode and r/ClaudeAI. Set up F5Bot alerts. Draft every post. |
| **1** (soft launch) | Feedback, bugs | Post to r/ClaudeCode (Tue). X launch thread (Tue). r/codex (Thu). r/SideProject (Fri). Reply to everything. Ship fixes the same day and say so in the threads. |
| **2** (main launch) | Peak attention | Show HN (Tue). r/ClaudeAI (Wed). r/ChatGPTCoding (Thu). Publish dev.to post #1 (the 30-day data post). Try for GitHub Trending: HN and Reddit landing on the same day can do it. |
| **3** | Second wave | Product Hunt (Tue). Newsletter submissions. Awesome-list PRs. r/vibecoding, r/opensource, r/bun spread across the week. Emails to creators. |
| **4–6** | Sustain | Posts #2–#4. Shorts series (two a week). Weekly X build-in-public. Answer every relevant F5Bot alert. Monthly "LARP Value" post. |
| **Ongoing** | React to news | When a model launches or a vendor changes limits or prices, post a timely screenshot within a day. These moments are when people search for this tool. |

---

## 5. Recurring content ideas

- **Monthly LARP receipt:** "October: $200 plan, $X of API-priced tokens." Invite replies with their own share cards. User posts are the cheapest marketing there is.
- **Rival memes:** the rival names are funny on their own. "Just passed *A Discord bot with feelings*. Next up: *A SaaS support bot*." Make a template image.
- **Release clips:** a 10-second clip of each new feature.
- **Speed leaderboard from your own data:** "Fastest model for me this week". Always framed as *my* logs, since there's no telemetry and that's a selling point.
- **Before/after of a limit reset** in Live mode or on the Limits tab.

---

## 6. Measuring it

Watch a few numbers weekly, in a simple spreadsheet:

| Metric | Where | Rough targets (realistic for a solo dev tool) |
| --- | --- | --- |
| GitHub stars | Repo | 100 after week 2, 500 after week 6, 1k+ if HN or Trending hits |
| npm weekly downloads | npmjs.com package page | 200/week by week 4 (`bunx` runs count as downloads) |
| Traffic sources | GitHub → Insights → Traffic | Shows which channel actually sent people |
| Issues and Discussions opened | Repo | A good sign: people use it enough to want more |
| Share-card posts seen | Search X and Reddit for "Token Larper" | Once the footer ships, the growth loop |

There's no telemetry, which is a selling point. So stars, downloads, and GitHub traffic are the only usage signals. Don't add analytics to the app to get more.

---

## 7. Making money from it (optional, later)

You said people can profit from it. Users certainly do, by catching overspend and limits. If you want something back yourself, ways that don't undercut the local, free, no-telemetry pitch:

- **GitHub Sponsors** and a "Sponsor" button on the repo and in Settings → About. Low effort, start now.
- **A paid team edition later:** opt-in aggregation across a team's machines, for leads who want per-person and per-project spend. Only if users ask for it, and keep it clearly separate from the free local app.
- Don't put ads or tracking in the app. It would kill the privacy story, which is the main reason the HN and Reddit crowd would trust it.

---

## 8. Ready-to-adapt post drafts

**r/ClaudeCode**

> **Title:** I built a local dashboard that shows how much of your 5-hour and weekly limit is left (plus what your plan would've cost at API prices)
>
> I kept running into the weekly limit without warning, and I wanted to know what my Max plan was actually worth. So I built Token Larper. It reads the session logs Claude Code already writes to `~/.claude/` and shows:
>
> - your 5-hour and weekly windows, per-model limits, and when each resets
> - tokens and cost per day, project, and model, including the "LARP value" (what those tokens would've cost on the API)
> - a Live mode that updates every second while you work
>
> It also counts Codex, Copilot CLI, Antigravity, OpenCode, and 13 other agents if you use them. Everything stays on your machine, with no telemetry.
>
> `bunx token-larper` (needs Bun). MIT, built on ccusage. Feedback very welcome, especially on what's missing.
>
> [video]

**Show HN first comment**

> Hi HN, I built this because I use Claude Code and Codex on subscriptions and had no idea how much of either plan I was using.
>
> Proxies like LiteLLM can't help here: these agents sign in with OAuth and talk to their vendor directly. But they already write every response, with token counts, to disk. Token Larper reads those logs (through ccusage plus its own scanners for Antigravity, OpenCode, and Copilot), so there's nothing to configure and nothing leaves the machine. The only network calls are an npm update check, a daily OpenRouter price list, and the quota lookups to each tool's own vendor. All three are listed in the README, and Offline mode turns them off.
>
> It's Bun + React, about 5 MB, no Electron. Happy to answer anything, and especially interested in which agents or numbers I'm missing.

**X launch post**

> My $200/mo Claude plan used $X,XXX worth of API tokens last month.
>
> I built a free, local dashboard that shows you yours, plus how much of your Claude, Codex, and Copilot limits is left.
>
> `bunx token-larper` 🧵

---

## Sources checked

- r/ClaudeAI showcase karma rule and megathread (mod post, April 2026): https://redlib.groet-infra.nl/r/ClaudeAI/comments/1sly3jm/built_with_claude_project_showcase_megathread/oq5dikl/?context=3
- Competing tools: ccboard (https://docs.rs/crate/ccboard/latest), claumon (https://pkg.go.dev/github.com/fabioconcina/claumon@v0.15.0), CCDash (https://awesome.ecosyste.ms/projects/github.com%2Fzihenghe04%2FCCDash), roundup (https://www.toriihq.com/articles/five-claude-code-usage-dashboards-and-monitoring-tools), comparison (https://dev.to/pederaa/how-to-track-claude-code-usage-in-2026-built-in-commands-ccusage-and-desktop-dashboards-compared-1kk1)
- The "$50K of tokens on a $200 plan" post that shows the LARP Value hook already works: https://dev.to/markliuyuxiang/i-consumed-50k-worth-of-claude-code-tokens-on-a-200-plan-should-i-be-blamed-4176
