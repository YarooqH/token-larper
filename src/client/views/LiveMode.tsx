import React, { useEffect, useMemo, useRef, useState } from "react";
import type { HarnessId, LiveEvent } from "../../types.ts";
import { useDashboard } from "../context.tsx";
import { Info, Maximize2, Minimize2 } from "../components/Icons.tsx";
import { formatRate } from "../lib/throughput.ts";
import {
  MINUTE,
  ago,
  eventTokens,
  forTool,
  liveSessions,
  liveSpeed,
  newTokens,
  rankBy,
  responseSpeed,
  rollingSeries,
  totalsBetween,
  useLiveFeed,
  type LiveFeed,
  type Ranked,
} from "../lib/live.ts";
import type { HarnessFilter } from "../lib/aggregate.ts";
import { formatCompactNumber, formatCurrency, formatExactNumber } from "../utils.ts";

// The whole screen while Live mode is on: one instrument for tokens per minute with every
// response on a tape under it, then what is burning them (tools, models, speed, sessions).

type Span = 15 | 60;
const SPANS: Span[] = [15, 60];
const SESSION_WINDOW_MS = 15 * MINUTE;
const FEED_LENGTH = 14;
const LIMITS_ID = "live-limitations";

/** What the big number leads with: the dollars per hour, or the tokens that are new each minute. */
export type Lead = "cost" | "tokens";
const LEADS: { id: Lead; label: string }[] = [
  { id: "cost", label: "Burn rate" },
  { id: "tokens", label: "New tokens" },
];
const LEAD_KEY = "token-larper-live-lead";

function loadLead(): Lead {
  try {
    return localStorage.getItem(LEAD_KEY) === "tokens" ? "tokens" : "cost";
  } catch {
    return "cost";
  }
}
const MAX_MODELS = 6;

const listFormat = new Intl.ListFormat("en-US", { type: "conjunction" });
const clock = (t: number, seconds = true) =>
  new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** "1.55M" as a number and a smaller unit. */
function Figure({ value, className = "" }: { value: number; className?: string }) {
  const text = formatCompactNumber(value);
  const unit = /[KMB]$/.test(text) ? text.slice(-1) : "";
  return (
    <span className={`lm-figure ${className}`}>
      {unit ? text.slice(0, -1) : text}
      {unit && <small>{unit}</small>}
    </span>
  );
}

/** Axis labels drop trailing zeros: "100K", "2.5M", "5M". */
const axisNumber = (n: number) => formatCompactNumber(n).replace(/\.?0+([KMB])$/, "$1");

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  return ([1, 2, 2.5, 5, 10].find((m) => m * pow >= max) ?? 10) * pow;
}

// ---------------------------------------------------------------------------

function Header({ feed, tool, setTool, span, setSpan, tools, lead, setLead }: {
  feed: LiveFeed;
  tool: HarnessFilter;
  setTool: (t: HarnessFilter) => void;
  span: Span;
  setSpan: (s: Span) => void;
  tools: HarnessId[];
  lead: Lead;
  setLead: (l: Lead) => void;
}) {
  const { seriesOf, nameOf } = useDashboard();
  const [fullscreen, setFullscreen] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const status = feed.status === "live" ? "Live" : feed.status === "reconnecting" ? "Reconnecting" : "Connecting";
  const showLimitations = () => {
    const list = document.getElementById(LIMITS_ID) as HTMLDetailsElement | null;
    if (!list) return;
    list.open = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    list.querySelector("summary")?.focus({ preventScroll: true });
  };

  return (
    <div className="lm-header">
      <div className="lm-status" role="status">
        <span className={`lm-badge is-${feed.status}`}><i aria-hidden="true" />{status}</span>
        <span className="lm-clock">{clock(feed.now)}</span>
      </div>
      <div className="lm-controls">
        <div className="lm-lead">
          <span className="lm-lead-label" id="lm-lead-label">Lead with</span>
          <div className="segmented" role="group" aria-labelledby="lm-lead-label">
            {LEADS.map((l) => (
              <button key={l.id} type="button" aria-pressed={lead === l.id} onClick={() => setLead(l.id)}>{l.label}</button>
            ))}
          </div>
        </div>
        {tools.length > 1 && (
          <div className="segmented lm-tools" role="group" aria-label="Tool">
            <button type="button" aria-pressed={tool === "all"} onClick={() => setTool("all")}>All</button>
            {tools.map((h) => (
              <button key={h} type="button" aria-pressed={tool === h} onClick={() => setTool(tool === h ? "all" : h)}>
                <i className="lm-dot" style={{ background: seriesOf(h).color }} aria-hidden="true" />
                {nameOf(h)}
              </button>
            ))}
          </div>
        )}
        <div className="segmented" role="group" aria-label="Time span">
          {SPANS.map((s) => (
            <button key={s} type="button" aria-pressed={span === s} onClick={() => setSpan(s)}>{s} min</button>
          ))}
        </div>
        <button type="button" className="lm-limits-link" onClick={showLimitations} aria-controls={LIMITS_ID}>
          <Info size={14} aria-hidden="true" />
          Limitations
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={toggleFullscreen}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        >
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A rolling per-minute measure, stacked by tool, with a crosshair that reads every tool at that moment. */
function Trace({ events, now, spanMs, order, valueOf, title }: {
  events: LiveEvent[];
  now: number;
  spanMs: number;
  order: string[];
  valueOf: (e: LiveEvent) => number;
  title: string;
}) {
  const { seriesOf, nameOf } = useDashboard();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 220;
  const step = spanMs <= 15 * MINUTE ? 5_000 : 20_000;
  const { times, byKey } = useMemo(
    () => rollingSeries(events, now, spanMs, step, (e) => e.harness, valueOf),
    [events, now, spanMs, step, valueOf],
  );
  const keys = [...byKey.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const totals = times.map((_, i) => keys.reduce((acc, k) => acc + byKey.get(k)![i]!, 0));
  const yMax = niceMax(Math.max(...totals) * 1.08);
  const n = times.length;
  const x = (i: number) => (i / (n - 1)) * width;
  const y = (v: number) => height - (v / yMax) * height;

  const below = new Array<number>(n).fill(0);
  const layers = keys.map((key) => {
    const values = byKey.get(key)!;
    const top = values.map((v, i) => below[i]! + v);
    const base = [...below];
    for (let i = 0; i < n; i++) below[i] = top[i]!;
    const line = top.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const back = base.map((v, i) => [i, v] as const).reverse().map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return { key, color: seriesOf(key as HarnessId).color, line, area: `${line} ${back} Z` };
  });

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setActive(Math.round(((e.clientX - box.left) / box.width) * (n - 1)));
  };
  const minutes = spanMs / MINUTE;
  const ticks = minutes === 15 ? [15, 10, 5] : [60, 45, 30, 15];

  return (
    <div className="lm-trace" ref={ref}>
      <span className="lm-trace-title">{title}</span>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line className="lm-grid" x1={0} x2={width} y1={y(yMax * f)} y2={y(yMax * f)} />
            {totals.some((t) => t > 0) && <text className="lm-axis" x={4} y={y(yMax * f) + 14}>{axisNumber(yMax * f)}/min</text>}
          </g>
        ))}
        <line className="lm-grid is-base" x1={0} x2={width} y1={height} y2={height} />
        {layers.map((l) => (
          <g key={l.key} style={{ color: l.color }}>
            <path className="lm-area" d={l.area} />
            <path className="lm-line" d={l.line} />
          </g>
        ))}
        {active !== null && <line className="lm-crosshair" x1={x(active)} x2={x(active)} y1={0} y2={height} />}
      </svg>
      <div
        className="lm-hit"
        role="img"
        aria-label={`${title} over the last ${minutes} minutes, now ${formatExactNumber(totals[n - 1] ?? 0)}`}
        onPointerMove={pick}
        onPointerLeave={() => setActive(null)}
      />
      {active !== null && (
        <div className={`uchart-tip ${active > n / 2 ? "side-left" : "side-right"}`} style={{ left: x(active), top: 8 }}>
          <div className="uchart-tip-head">
            <strong>{clock(times[active]!)}</strong>
            <span>{formatCompactNumber(totals[active]!)}/min</span>
          </div>
          {totals[active]! > 0 ? (
            <ul>
              {keys
                .map((k) => ({ k, v: byKey.get(k)![active]! }))
                .filter(({ v }) => v > 0)
                .sort((a, b) => b.v - a.v)
                .map(({ k, v }) => (
                  <li key={k}>
                    <i style={{ background: seriesOf(k as HarnessId).color }} />
                    <span>{nameOf(k as HarnessId)}</span>
                    <b>{formatCompactNumber(v)}</b>
                  </li>
                ))}
            </ul>
          ) : (
            <div className="uchart-tip-empty">Nothing in the minute before</div>
          )}
        </div>
      )}
      <div className="lm-timeaxis" aria-hidden="true">
        {ticks.map((m) => (
          <span key={m} className={m === minutes ? "is-start" : undefined} style={{ left: `${(1 - m / minutes) * 100}%` }}>
            {m} min ago
          </span>
        ))}
        <span className="is-now">now</span>
      </div>
    </div>
  );
}

/** Every response as a tick at the moment its last token landed; taller ticks wrote more output. */
function Tape({ events, now, spanMs }: { events: LiveEvent[]; now: number; spanMs: number }) {
  const { seriesOf, nameOf } = useDashboard();
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 48;
  const shown = events.filter((e) => now - e.at <= spanMs);
  const maxOut = Math.max(1, ...shown.map((e) => e.outputTokens));
  return (
    <div className="lm-tape" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${shown.length} responses in the last ${spanMs / MINUTE} minutes`}>
        {shown.map((e) => {
          const h = Math.max(5, Math.sqrt(e.outputTokens / maxOut) * (height - 4));
          const speed = responseSpeed(e);
          return (
            <rect
              key={e.id}
              className={now - e.at < 4_000 ? "lm-tick is-new" : "lm-tick"}
              x={width - ((now - e.at) / spanMs) * width - 1}
              y={height - h}
              width={2.5}
              height={h}
              rx={1.25}
              style={{ fill: seriesOf(e.harness).color }}
            >
              <title>
                {`${clock(e.at)} · ${nameOf(e.harness)} · ${e.model}\n${formatExactNumber(e.outputTokens)} output tokens` +
                  (speed ? ` · ≈${formatRate(speed)} tok/s` : "")}
              </title>
            </rect>
          );
        })}
      </svg>
      {shown.length === 0 && <p className="lm-tape-empty">Each response lands here as it finishes.</p>}
    </div>
  );
}

function Readout({ label, children, note, hint }: { label: string; children: React.ReactNode; note?: string; hint: string }) {
  return (
    <div className="lm-readout" title={hint}>
      <span className="lm-label">{label}</span>
      <span className="lm-readout-value">{children}</span>
      {note && <span className="lm-note">{note}</span>}
    </div>
  );
}

function Instrument({ events, now, spanMs, order, lead }: {
  events: LiveEvent[];
  now: number;
  spanMs: number;
  order: string[];
  lead: Lead;
}) {
  const { nameOf } = useDashboard();
  const minute = totalsBetween(events, now - MINUTE, Infinity);
  const five = totalsBetween(events, now - 5 * MINUTE, Infinity);
  const hour = totalsBetween(events, now - 60 * MINUTE, Infinity);
  const speed = liveSpeed(events.filter((e) => e.at >= now - 5 * MINUTE));
  const sessions = liveSessions(events, now, SESSION_WINDOW_MS);
  const working = sessions.filter((s) => now - s.lastAt < MINUTE).length;
  const biggest = sessions.reduce<(typeof sessions)[number] | null>((top, s) => (!top || s.context > top.context ? s : top), null);
  const perResponse = hour.responses > 0 ? hour.cost / hour.responses : null;

  const burn = (
    <Readout key="burn" label="Burn rate" note={`${formatCurrency(hour.cost)} last hour`} hint="The last 5 minutes' pace, at API list prices">
      {formatCurrency(five.cost * 12)}<em>/hr</em>
    </Readout>
  );
  const readouts = [
    ...(lead === "tokens" ? [burn] : []),
    <Readout key="output" label="Output" note={`5-min avg ${formatCompactNumber(five.outputTokens / 5)}`} hint="Tokens the models wrote in the last minute">
      <Figure value={minute.outputTokens} />
      <em>/min</em>
    </Readout>,
    <Readout key="speed" label="Speed" hint="The median response's output tokens per second over the last 5 minutes, including the wait for the first token">
      {speed ? <>{formatRate(speed.median)}<em>tok/s</em></> : <span className="lm-dim">—</span>}
    </Readout>,
    <Readout key="requests" label="Requests" note={`5-min avg ${(five.responses / 5).toFixed(1)}`} hint="Responses that finished in the last minute">
      {minute.responses}<em>/min</em>
    </Readout>,
    <Readout
      key="context"
      label="Context"
      note={biggest ? biggest.project || nameOf(biggest.harness) : undefined}
      hint="The largest latest prompt among sessions active in the last 15 minutes, cache included"
    >
      {biggest ? <Figure value={biggest.context} /> : <span className="lm-dim">—</span>}
    </Readout>,
    <Readout key="agents" label="Agents working" note={`${sessions.length} in 15 min`} hint="Sessions that answered in the last minute">
      {working}<em>{working === 1 ? "session" : "sessions"}</em>
    </Readout>,
  ];

  return (
    <section className="lm-instrument" aria-label={lead === "cost" ? "Burn rate" : "New tokens per minute"}>
      <div className="lm-hero">
        {lead === "cost" ? (
          <div className="lm-hero-main">
            <span className="lm-label">Burn rate</span>
            <span className="lm-figure lm-hero-figure">
              {formatCurrency(five.cost * 12)}
              <small>/hr</small>
            </span>
            <span className="lm-note" title="The last 5 minutes' pace, at API list prices">
              {formatCurrency(hour.cost)} last hour
              {perResponse !== null && ` · ${formatCurrency(perResponse)} per response`}
            </span>
          </div>
        ) : (
          <div className="lm-hero-main">
            <div className="lm-hero-pair">
              <div>
                <span className="lm-label" title="Input, cache writes and output in the last minute">New tokens per minute</span>
                <Figure value={newTokens(minute)} className="lm-hero-figure" />
              </div>
              <div className="lm-hero-side">
                <span className="lm-label" title="The conversation sent again from cache with each request">Cache re-reads</span>
                <span className="lm-hero-side-value"><Figure value={minute.cacheReadTokens} /><em>/min</em></span>
              </div>
            </div>
            <span className="lm-note">5-min avg {formatCompactNumber(newTokens(five) / 5)}</span>
          </div>
        )}
        <div className="lm-readouts">{readouts}</div>
      </div>
      {lead === "cost" ? (
        <Trace events={events} now={now} spanMs={spanMs} order={order} valueOf={eventTokens} title="Tokens / min, incl. cache re-reads" />
      ) : (
        <Trace events={events} now={now} spanMs={spanMs} order={order} valueOf={newTokens} title="New tokens / min" />
      )}
      <Tape events={events} now={now} spanMs={spanMs} />
    </section>
  );
}

// ---------------------------------------------------------------------------

function RankList({ title, rows, by, spanMinutes }: { title: string; rows: Ranked[]; by: "tool" | "model"; spanMinutes: number }) {
  const { seriesOf, nameOf } = useDashboard();
  const shown = rows.slice(0, by === "model" ? MAX_MODELS : rows.length);
  const max = shown[0]?.totals.totalTokens ?? 0;
  return (
    <section className="lm-panel">
      <header className="lm-panel-head">
        <h2>{title}</h2>
        <span className="lm-note">Last {spanMinutes} min</span>
      </header>
      {shown.length === 0 ? (
        <p className="lm-empty">Nothing yet.</p>
      ) : (
        <ul className="lm-ranks">
          {shown.map((r) => (
            <li key={r.key}>
              <div className="lm-rank-name">
                <i className="lm-dot" style={{ background: seriesOf(r.harness).color }} aria-hidden="true" />
                {by === "model" ? (
                  <>
                    <code>{r.model}</code>
                    <span className="lm-note">{nameOf(r.harness)}</span>
                  </>
                ) : (
                  <strong>{nameOf(r.harness)}</strong>
                )}
                <Figure value={r.totals.totalTokens} className="lm-rank-value" />
              </div>
              <span className="lm-bar" aria-hidden="true">
                <span style={{ width: `${max > 0 ? Math.max(1.5, (r.totals.totalTokens / max) * 100) : 0}%`, background: seriesOf(r.harness).color }} />
              </span>
              <div className="lm-rank-meta">
                <span>{r.lastMinute ? `${formatCompactNumber(r.lastMinute)}/min now` : "quiet this minute"}</span>
                <span>{r.totals.responses} {r.totals.responses === 1 ? "response" : "responses"}</span>
                {r.speed && <span>≈{formatRate(r.speed.tokensPerSecond)} tok/s</span>}
                <span>{formatCurrency(r.totals.cost)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length && <p className="lm-note lm-more">+{rows.length - shown.length} more</p>}
    </section>
  );
}

/** Each response's output speed as a dot, with the 5-minute median as a line. */
function SpeedPanel({ events, now, spanMs }: { events: LiveEvent[]; now: number; spanMs: number }) {
  const { seriesOf, nameOf } = useDashboard();
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 180;
  const points = events
    .filter((e) => now - e.at <= spanMs)
    .map((e) => ({ e, v: responseSpeed(e) }))
    .filter((p): p is { e: LiveEvent; v: number } => p.v !== null);
  const yMax = niceMax(Math.max(10, ...points.map((p) => p.v)) * 1.05);
  const x = (t: number) => width - ((now - t) / spanMs) * width;
  const y = (v: number) => height - (v / yMax) * (height - 6) - 3;

  const step = spanMs / 60;
  const median: string[] = [];
  for (let t = now - spanMs; t <= now + 1; t += step) {
    const s = liveSpeed(events.filter((e) => e.at > t - 5 * MINUTE && e.at <= t));
    if (s) median.push(`${median.length ? "L" : "M"}${x(t).toFixed(1)},${y(s.median).toFixed(1)}`);
  }
  const current = liveSpeed(events.filter((e) => e.at >= now - 5 * MINUTE));

  return (
    <section className="lm-panel">
      <header className="lm-panel-head">
        <h2 title="Each dot is one response, timed from the request to its last token. The line is the median of the 5 minutes before it.">Output speed</h2>
        <span className="lm-note">{current ? `median ${formatRate(current.median)} tok/s` : "No timed responses yet"}</span>
      </header>
      <div className="lm-speed" ref={ref}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Output speed of ${points.length} responses`}>
          <line className="lm-grid" x1={0} x2={width} y1={y(yMax / 2)} y2={y(yMax / 2)} />
          <text className="lm-axis" x={4} y={y(yMax / 2) - 5}>{formatRate(yMax / 2)} tok/s</text>
          <line className="lm-grid is-base" x1={0} x2={width} y1={height} y2={height} />
          {points.map(({ e, v }) => (
            <circle key={e.id} className="lm-speed-dot" cx={x(e.at)} cy={y(v)} r={4} style={{ fill: seriesOf(e.harness).color }}>
              <title>{`${clock(e.at)} · ${nameOf(e.harness)} · ${e.model}\n≈${formatRate(v)} tok/s · ${formatExactNumber(e.outputTokens)} output tokens`}</title>
            </circle>
          ))}
          {median.length > 1 && <path className="lm-median" d={median.join(" ")} />}
        </svg>
      </div>
    </section>
  );
}

function Sessions({ events, now }: { events: LiveEvent[]; now: number }) {
  const { seriesOf, nameOf } = useDashboard();
  const sessions = useMemo(() => liveSessions(events, now, SESSION_WINDOW_MS), [events, now]);
  return (
    <section className="lm-panel lm-sessions">
      <header className="lm-panel-head">
        <h2>Sessions</h2>
        <span className="lm-note">Last 15 min</span>
      </header>
      {sessions.length === 0 ? (
        <p className="lm-empty">No session has answered in the last 15 minutes.</p>
      ) : (
        <div className="lm-session-grid">
          {sessions.map((s) => (
            <article key={s.key} className="lm-session">
              <header>
                <span className={`lm-pulse ${now - s.lastAt < MINUTE ? "is-on" : ""}`} aria-hidden="true" />
                <strong>{s.project ?? "Unknown folder"}</strong>
                <span className="lm-note">{ago(now - s.lastAt)}</span>
              </header>
              <div className="lm-session-tool">
                <i className="lm-dot" style={{ background: seriesOf(s.harness).color }} aria-hidden="true" />
                {nameOf(s.harness)} · <code>{s.models[0]}</code>
              </div>
              <dl>
                <div>
                  <dt>Now</dt>
                  <dd><Figure value={s.lastMinute} /><em>/min</em></dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd title="The latest response's prompt: input, cache write and cache read"><Figure value={s.context} /></dd>
                </div>
                <div>
                  <dt>Speed</dt>
                  <dd>{s.speed ? <>{formatRate(s.speed.median)}<em>tok/s</em></> : "—"}</dd>
                </div>
                <div>
                  <dt>Last hour</dt>
                  <dd>{formatCurrency(s.totals.cost)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Feed({ events }: { events: LiveEvent[] }) {
  const { seriesOf, nameOf } = useDashboard();
  const latest = useMemo(() => [...events].sort((a, b) => b.at - a.at).slice(0, FEED_LENGTH), [events]);
  return (
    <section className="lm-panel lm-feed">
      <header className="lm-panel-head">
        <h2>Responses</h2>
      </header>
      {latest.length === 0 ? (
        <p className="lm-empty">Waiting for the first response.</p>
      ) : (
        <ol>
          {latest.map((e) => {
            const speed = responseSpeed(e);
            return (
              <li key={e.id} className="lm-feed-row">
                <time>{clock(e.at)}</time>
                <i className="lm-dot" style={{ background: seriesOf(e.harness).color }} title={nameOf(e.harness)} />
                <code>{e.model}</code>
                <span className="lm-feed-num">{formatCompactNumber(e.outputTokens)} out</span>
                <span className="lm-feed-num lm-dim">{speed ? `${formatRate(speed)} tok/s` : ""}</span>
                <span className="lm-feed-num">{formatCurrency(e.cost)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** Live mode with a given feed; split from LiveMode so tests can pass a fixed one. */
export function LiveBoard({ feed, initialLead }: { feed: LiveFeed; initialLead?: Lead }) {
  const { data, series } = useDashboard();
  const [span, setSpan] = useState<Span>(15);
  const [lead, setLeadState] = useState<Lead>(() => initialLead ?? loadLead());
  const setLead = (next: Lead) => {
    setLeadState(next);
    try {
      localStorage.setItem(LEAD_KEY, next);
    } catch {
      // Storage may be disabled; the choice just doesn't stick.
    }
  };
  const [tool, setTool] = useState<HarnessFilter>("all");
  const { now } = feed;
  const spanMs = span * MINUTE;
  const order = series.map((s) => s.key);
  const tools = useMemo(() => [...new Set(feed.events.map((e) => e.harness))], [feed.events]);
  const events = useMemo(() => forTool(feed.events, tools.includes(tool as HarnessId) ? tool : "all"), [feed.events, tool, tools]);
  const byTool = useMemo(() => rankBy(events, now - spanMs, now, "tool"), [events, now, spanMs]);
  const byModel = useMemo(() => rankBy(events, now - spanMs, now, "model"), [events, now, spanMs]);

  const followed = feed.snapshot?.tools ?? [];
  const notFollowed = data.harnesses.filter((h) => h.meta.hasUsage && !followed.includes(h.meta.id)).map((h) => h.meta.name);

  if (!feed.snapshot) {
    return (
      <div className="lm lm-connecting" role="status">
        <span className={`lm-badge is-${feed.status}`}><i aria-hidden="true" />{feed.status === "reconnecting" ? "Reconnecting" : "Connecting"}</span>
        <p>Reading the last hour of your session logs…</p>
      </div>
    );
  }

  return (
    <div className="lm">
      <Header feed={feed} tool={tool} setTool={setTool} span={span} setSpan={setSpan} tools={tools} lead={lead} setLead={setLead} />
      <Instrument events={events} now={now} spanMs={spanMs} order={order} lead={lead} />
      <div className="lm-grid-3">
        <RankList title="By tool" rows={byTool} by="tool" spanMinutes={span} />
        <RankList title="By model" rows={byModel} by="model" spanMinutes={span} />
        <SpeedPanel events={events} now={now} spanMs={spanMs} />
      </div>
      <div className="lm-grid-2">
        <Sessions events={events} now={now} />
        <Feed events={events} />
      </div>
      <Limitations notFollowed={notFollowed} />
    </div>
  );
}

/** What Live mode can't see, so its numbers aren't read as the whole picture. */
function Limitations({ notFollowed }: { notFollowed: string[] }) {
  return (
    <details className="lm-limits" id={LIMITS_ID}>
      <summary>What Live mode can't see</summary>
      <ul>
        <li>
          <strong>Claude chats.</strong> Chats on claude.ai and in the Claude app aren't saved on this computer, so they never appear
          here. Only the Code tab in the Claude app counts, since it runs Claude Code.
        </li>
        <li>
          <strong>Some tools.</strong> Live mode follows Claude Code (including the Code tab in the Claude app), Codex, Pi, Gemini CLI,
          Antigravity, and Copilot CLI with OpenTelemetry file export turned on.
          {notFollowed.length > 0 && ` Of the tools you use, ${listFormat.format(notFollowed)} ${notFollowed.length === 1 ? "isn't" : "aren't"} followed.`}
          {" "}Every tool still shows up in the dashboard after a sync.
        </li>
        <li>
          <strong>Responses in progress.</strong> A response counts when its last token is logged, so a long one lands all at once and
          tokens per minute comes in bursts.
        </li>
        <li>
          <strong>More than an hour back.</strong> Only the last hour is kept. It is read again from the session files when Token Larper
          starts.
        </li>
        <li>
          <strong>What you actually pay.</strong> Costs and the burn rate use API list prices, even on a subscription. A model with no
          known price adds $0.
        </li>
        <li>
          <strong>Pure generation speed.</strong> Speed includes the wait for the first token. Antigravity records times to the second,
          so its short steps read rough.
        </li>
      </ul>
      <p className="lm-note">Tokens include cache reads, the same as everywhere else in the dashboard, so they run far above what the model writes.</p>
    </details>
  );
}

export function LiveMode() {
  const feed = useLiveFeed();
  return <LiveBoard feed={feed} />;
}
