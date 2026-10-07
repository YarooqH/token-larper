import React, { useMemo, useState } from "react";
import type { HarnessId, LiveEvent } from "../../types.ts";
import { TOKEN_TYPE_SERIES, UsageBarChart, type ChartMode } from "../charts.tsx";
import { EmptyState, ToolTag, useDashboard } from "../context.tsx";
import { Sparkline } from "../components/KpiCards.tsx";
import { countsForSpeed } from "../../throughput/stats.ts";
import { formatRate } from "../lib/throughput.ts";
import {
  MINUTE,
  ago,
  forTool,
  liveBuckets,
  liveSessions,
  liveSpeed,
  perMinute,
  totalsBetween,
  useLiveFeed,
  type LiveFeed,
} from "../lib/live.ts";
import { formatCompactNumber, formatCurrency, formatExactNumber } from "../utils.ts";
import { Segmented } from "./Overview.tsx";

type Span = "15m" | "60m";

const SPANS: { id: Span; label: string }[] = [
  { id: "15m", label: "15 min" },
  { id: "60m", label: "60 min" },
];

// 60 bars either way: 15-second bars over 15 minutes, or minute bars over the hour.
const BUCKET_MS: Record<Span, number> = { "15m": 15_000, "60m": MINUTE };

const MODES: { id: ChartMode; label: string }[] = [
  { id: "tokens-by-harness", label: "Tokens by tool" },
  { id: "cost-by-harness", label: "Cost" },
  { id: "token-types", label: "Token mix" },
];

/** Sessions stay listed this long after their last response. */
const SESSION_WINDOW_MS = 15 * MINUTE;
const FEED_LENGTH = 30;
const SPARK_MINUTES = 15;

const listFormat = new Intl.ListFormat("en-US", { type: "conjunction" });

function responseSpeed(e: LiveEvent): number | null {
  if (e.start === undefined) return null;
  const sample = { model: e.model, start: e.start, end: e.at, outputTokens: e.outputTokens };
  return countsForSpeed(sample) ? e.outputTokens / ((e.at - e.start) / 1000) : null;
}

function StatusLine({ feed, toolsInUse }: { feed: LiveFeed; toolsInUse: HarnessId[] }) {
  const { nameOf } = useDashboard();
  const { status, snapshot } = feed;
  const followed = snapshot?.tools ?? [];
  const notFollowed = toolsInUse.filter((h) => !followed.includes(h));
  const label = status === "live" ? "Live" : status === "reconnecting" ? "Reconnecting…" : "Connecting…";
  return (
    <div className="live-status" role="status">
      <span className={`live-badge is-${status}`}>
        <i aria-hidden="true" />
        {label}
      </span>
      {snapshot && (
        <span className="live-status-text" title={`Followed live: ${listFormat.format(followed.map(nameOf))}.`}>
          Following {snapshot.files} {snapshot.files === 1 ? "session file" : "session files"} written in the last hour.
          {notFollowed.length > 0 &&
            ` ${listFormat.format(notFollowed.map(nameOf))} ${notFollowed.length === 1 ? "keeps its" : "keep their"} logs in a database, so ${notFollowed.length === 1 ? "it shows" : "they show"} on the other tabs after a sync instead.`}
        </span>
      )}
    </div>
  );
}

function LiveKpis({ events, now, activeSessions }: { events: LiveEvent[]; now: number; activeSessions: number }) {
  const lastMinute = totalsBetween(events, now - MINUTE, Infinity);
  const lastFive = totalsBetween(events, now - 5 * MINUTE, Infinity);
  const lastHour = totalsBetween(events, now - 60 * MINUTE, Infinity);
  const speed = liveSpeed(events.filter((e) => e.at >= now - 5 * MINUTE));
  const spark = (pick: Parameters<typeof perMinute>[3]) => perMinute(events, now, SPARK_MINUTES, pick);

  return (
    <section className="kpi-grid" aria-label="Live rates">
      <article className="kpi">
        <h3 className="kpi-label">Tokens / min</h3>
        <div className="kpi-value" title={`${formatExactNumber(lastMinute.totalTokens)} tokens in the last 60 seconds`}>
          {formatCompactNumber(lastMinute.totalTokens)}
        </div>
        <p className="kpi-sub">{formatCompactNumber(lastFive.totalTokens / 5)}/min over 5 min</p>
        <span className="kpi-delta">
          {formatCompactNumber(lastMinute.cacheReadTokens)} cached · {formatCompactNumber(lastMinute.inputTokens + lastMinute.cacheCreationTokens)} in
        </span>
        <Sparkline values={spark((t) => t.totalTokens)} />
      </article>

      <article className="kpi">
        <h3 className="kpi-label">Output / min</h3>
        <div className="kpi-value">{formatCompactNumber(lastMinute.outputTokens)}</div>
        <p className="kpi-sub">{formatCompactNumber(lastFive.outputTokens / 5)}/min over 5 min</p>
        <span className="kpi-delta" title="Output tokens over the time from each request to its last token, over the last 5 minutes. That includes waiting for the first token.">
          {speed ? `≈${formatRate(speed.tokensPerSecond)} tok/s per response` : "No timed responses in 5 min"}
        </span>
        <Sparkline values={spark((t) => t.outputTokens)} />
      </article>

      <article className="kpi">
        <h3 className="kpi-label">Requests / min</h3>
        <div className="kpi-value">{lastMinute.responses}</div>
        <p className="kpi-sub">{(lastFive.responses / 5).toFixed(1)}/min over 5 min</p>
        <span className="kpi-delta">
          {activeSessions} {activeSessions === 1 ? "session" : "sessions"} active in 15 min
        </span>
        <Sparkline values={spark((t) => t.responses)} />
      </article>

      <article className="kpi">
        <h3 className="kpi-label">Burn rate</h3>
        <div className="kpi-value">
          {formatCurrency(lastFive.cost * 12)}
          <span className="kpi-of"> /hr</span>
        </div>
        <p className="kpi-sub">Pace of the last 5 min, at API list prices</p>
        <span className="kpi-delta">{formatCurrency(lastHour.cost)} in the last hour</span>
        <Sparkline values={spark((t) => t.cost)} />
      </article>
    </section>
  );
}

function SessionsPanel({ events, now }: { events: LiveEvent[]; now: number }) {
  const sessions = useMemo(() => liveSessions(events, now, SESSION_WINDOW_MS), [events, now]);
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Active sessions</h2>
          <p>Sessions with a response in the last 15 minutes. Totals cover the last hour.</p>
        </div>
      </header>
      {sessions.length === 0 ? (
        <p className="muted">Nothing active in the last 15 minutes.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Project</th>
                <th>Model</th>
                <th>Last response</th>
                <th className="num">Last min</th>
                <th className="num">Speed</th>
                <th className="num">Tokens</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.key}>
                  <td><ToolTag id={s.harness} /></td>
                  <td>{s.project ? <strong>{s.project}</strong> : <span className="muted">Unknown</span>}</td>
                  <td>
                    <div className="tag-row">
                      <code className="model-name nowrap">{s.models[0]}</code>
                      {s.models.length > 1 && <span className="muted">+{s.models.length - 1}</span>}
                    </div>
                  </td>
                  <td className="nowrap">
                    <span className={`live-when ${now - s.lastAt < MINUTE ? "is-recent" : ""}`}>
                      <i aria-hidden="true" />
                      {ago(now - s.lastAt)}
                    </span>
                  </td>
                  <td className="num">{s.lastMinute ? formatCompactNumber(s.lastMinute) : <span className="muted">—</span>}</td>
                  <td className="num">{s.speed ? `≈${formatRate(s.speed.tokensPerSecond)} tok/s` : <span className="muted">—</span>}</td>
                  <td className="num strong">{formatCompactNumber(s.totals.totalTokens)}</td>
                  <td className="num">{formatCurrency(s.totals.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FeedPanel({ events }: { events: LiveEvent[] }) {
  const latest = useMemo(() => [...events].sort((a, b) => b.at - a.at).slice(0, FEED_LENGTH), [events]);
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>Latest responses</h2>
          <p>The last {FEED_LENGTH} responses, newest first. A response still streaming updates in place.</p>
        </div>
      </header>
      <div className="table-scroll">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Time</th>
              <th>Tool</th>
              <th>Project</th>
              <th>Model</th>
              <th className="num">Input</th>
              <th className="num">Output</th>
              <th className="num">Cache read</th>
              <th className="num">Speed</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {latest.map((e) => {
              const speed = responseSpeed(e);
              return (
                <tr key={e.id} className="live-row">
                  <td className="nowrap">{new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</td>
                  <td><ToolTag id={e.harness} /></td>
                  <td>{e.project ?? <span className="muted">—</span>}</td>
                  <td><code className="model-name nowrap">{e.model}</code></td>
                  <td className="num" title={`${formatExactNumber(e.inputTokens)} input + ${formatExactNumber(e.cacheCreationTokens)} cache write`}>
                    {formatCompactNumber(e.inputTokens + e.cacheCreationTokens)}
                  </td>
                  <td className="num">{formatCompactNumber(e.outputTokens)}</td>
                  <td className="num">{formatCompactNumber(e.cacheReadTokens)}</td>
                  <td className="num">{speed === null ? <span className="muted">—</span> : `≈${formatRate(speed)} tok/s`}</td>
                  <td className="num">{formatCurrency(e.cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Rendered by Live once the feed is connected; split out so tests can pass a fixed feed. */
export function LiveBoard({ feed }: { feed: LiveFeed }) {
  const { data, harness, series, seriesOf } = useDashboard();
  const [span, setSpan] = useState<Span>("15m");
  const [mode, setMode] = useState<ChartMode>("tokens-by-harness");
  const { now } = feed;
  const events = useMemo(() => forTool(feed.events, harness), [feed.events, harness]);
  const rows = useMemo(() => liveBuckets(events, now, BUCKET_MS[span], 60), [events, now, span]);
  const activeSessions = useMemo(() => liveSessions(events, now, SESSION_WINDOW_MS).length, [events, now]);
  const toolsInUse = data.harnesses.filter((h) => h.meta.hasUsage).map((h) => h.meta.id);

  const legend = useMemo(() => {
    if (mode === "token-types") return TOKEN_TYPE_SERIES;
    const present = new Set(events.map((e) => seriesOf(e.harness).key));
    return series.filter((s) => present.has(s.key));
  }, [mode, events, series, seriesOf]);

  const spanTokens = rows.reduce((acc, r) => acc + r.totalTokens, 0);

  return (
    <>
      <StatusLine feed={feed} toolsInUse={toolsInUse} />

      {feed.snapshot && (
        <>
          <LiveKpis events={events} now={now} activeSessions={activeSessions} />

          <section className="panel">
            <header className="panel-head">
              <div>
                <h2>Tokens as they land</h2>
                <p>
                  {formatCompactNumber(spanTokens)} tokens in the last {span === "15m" ? "15 minutes, in 15-second bars" : "hour, in 1-minute bars"}.
                  A response counts when its last token is logged.
                </p>
              </div>
              <div className="panel-controls">
                <Segmented label="Time span" value={span} options={SPANS} onChange={setSpan} />
                <Segmented label="Chart shows" value={mode} options={MODES} onChange={setMode} />
              </div>
            </header>
            <UsageBarChart
              rows={rows}
              mode={mode}
              granularity="daily"
              costOf={(c) => c.estimatedCost}
              series={series}
              seriesOf={seriesOf}
              formatLabel={(row, short) => (short ? row.label.replace(/\s?[AP]M$/i, "") : row.label)}
            />
            {legend.length > 0 && (
              <div className="legend">
                {legend.map((s) => (
                  <span key={s.key} className="legend-item">
                    <i style={{ background: s.color }} aria-hidden="true" /> {s.name}
                  </span>
                ))}
              </div>
            )}
          </section>

          {events.length === 0 ? (
            <EmptyState>
              <p className="muted">
                No responses in the last hour{harness === "all" ? "" : " from this tool"}. Send a prompt in a coding tool and it shows up here
                within a second or two.
              </p>
            </EmptyState>
          ) : (
            <>
              <SessionsPanel events={events} now={now} />
              <FeedPanel events={events} />
            </>
          )}
        </>
      )}
    </>
  );
}

export function Live() {
  const feed = useLiveFeed();
  return <LiveBoard feed={feed} />;
}
