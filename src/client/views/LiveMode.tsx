import React, { useEffect, useMemo, useRef, useState } from "react";
import type { HarnessId, LiveEvent, PlanUsage } from "../../types.ts";
import { useDashboard } from "../context.tsx";
import { Maximize2, Minimize2 } from "../components/Icons.tsx";
import { formatRate } from "../lib/throughput.ts";
import {
  MINUTE,
  ago,
  forTool,
  liveSessions,
  liveSpeed,
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

const HOUR = 60 * MINUTE;

/** "just now", "12 min ago", "6 h ago", "3 d ago". */
function checkedAgo(ms: number): string {
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < 48 * HOUR) return `${Math.floor(ms / HOUR)} h ago`;
  return `${Math.floor(ms / (24 * HOUR))} d ago`;
}

function Meter({ label, value, stale }: { label: string; value: number | null; stale?: string }) {
  const shown = stale ? null : value;
  return (
    <span
      className={`lm-meter ${shown !== null && shown >= 80 ? "is-high" : ""}`}
      role="meter"
      aria-label={`${label} limit used`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={shown ?? undefined}
      title={stale}
    >
      <span className="lm-meter-label">{label}</span>
      <span className="lm-meter-track" aria-hidden="true">
        <span style={{ width: `${Math.min(100, shown ?? 0)}%` }} />
      </span>
      <span className="lm-meter-value">{shown === null ? "—" : `${Math.round(shown)}%`}</span>
    </span>
  );
}

/** How much of the Claude plan's limits is used, as the Claude desktop app last saw it. */
function PlanMeter({ plan, now }: { plan: PlanUsage; now: number }) {
  const age = Math.max(0, now - plan.at);
  return (
    <div
      className={`lm-plan ${age > 5 * HOUR ? "is-stale" : ""}`}
      title="From the Claude desktop app, which checks your plan's limits every 15 minutes or so while it is checking usage. Limits count chats and Claude Code alike."
    >
      <span className="lm-label">Plan</span>
      <Meter label="5-hour" value={plan.fiveHour} stale={age > 5 * HOUR ? "The 5-hour window has reset since the app last checked." : undefined} />
      <Meter label="Week" value={plan.weekly} stale={age > 7 * 24 * HOUR ? "The week has reset since the app last checked." : undefined} />
      <span className="lm-note">checked {checkedAgo(age)}</span>
    </div>
  );
}

function Header({ feed, tool, setTool, span, setSpan, tools }: {
  feed: LiveFeed;
  tool: HarnessFilter;
  setTool: (t: HarnessFilter) => void;
  span: Span;
  setSpan: (s: Span) => void;
  tools: HarnessId[];
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

  return (
    <div className="lm-header">
      <div className="lm-status" role="status">
        <span className={`lm-badge is-${feed.status}`}><i aria-hidden="true" />{status}</span>
        <span className="lm-clock">{clock(feed.now)}</span>
      </div>
      {feed.snapshot?.plan && <PlanMeter plan={feed.snapshot.plan} now={feed.now} />}
      <div className="lm-controls">
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

/** Rolling tokens per minute, stacked by tool, with a crosshair that reads every tool at that moment. */
function Trace({ events, now, spanMs, order }: { events: LiveEvent[]; now: number; spanMs: number; order: string[] }) {
  const { seriesOf, nameOf } = useDashboard();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 220;
  const step = spanMs <= 15 * MINUTE ? 5_000 : 20_000;
  const { times, byKey } = useMemo(() => rollingSeries(events, now, spanMs, step, (e) => e.harness), [events, now, spanMs, step]);
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
      <svg width={width} height={height} aria-hidden="true">
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
        aria-label={`Tokens per minute over the last ${minutes} minutes, now ${formatExactNumber(totals[n - 1] ?? 0)}`}
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
          <span key={m} style={{ left: `${(1 - m / minutes) * 100}%` }}>{m} min ago</span>
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
      <svg width={width} height={height} role="img" aria-label={`${shown.length} responses in the last ${spanMs / MINUTE} minutes`}>
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

function Readout({ label, children, note }: { label: string; children: React.ReactNode; note: string }) {
  return (
    <div className="lm-readout">
      <span className="lm-label">{label}</span>
      <span className="lm-readout-value">{children}</span>
      <span className="lm-note">{note}</span>
    </div>
  );
}

function Instrument({ events, now, spanMs, order }: { events: LiveEvent[]; now: number; spanMs: number; order: string[] }) {
  const minute = totalsBetween(events, now - MINUTE, Infinity);
  const five = totalsBetween(events, now - 5 * MINUTE, Infinity);
  const hour = totalsBetween(events, now - 60 * MINUTE, Infinity);
  const speed = liveSpeed(events.filter((e) => e.at >= now - 5 * MINUTE));
  const promptTokens = minute.inputTokens + minute.cacheCreationTokens + minute.cacheReadTokens;
  const cached = promptTokens > 0 ? Math.round((minute.cacheReadTokens / promptTokens) * 100) : null;

  return (
    <section className="lm-instrument" aria-label="Tokens per minute">
      <div className="lm-hero">
        <div className="lm-hero-main">
          <span className="lm-label">Tokens per minute</span>
          <Figure value={minute.totalTokens} className="lm-hero-figure" />
          <span className="lm-note">
            {formatCompactNumber(five.totalTokens / 5)}/min over 5 min
            {cached !== null && ` · ${cached}% of the prompt from cache`}
          </span>
        </div>
        <div className="lm-readouts">
          <Readout label="Output" note={`${formatCompactNumber(five.outputTokens / 5)}/min over 5 min`}>
            <Figure value={minute.outputTokens} />
            <em>/min</em>
          </Readout>
          <Readout label="Speed" note="Median response, last 5 min">
            {speed ? <>{formatRate(speed.median)}<em>tok/s</em></> : <span className="lm-dim">—</span>}
          </Readout>
          <Readout label="Requests" note={`${(five.responses / 5).toFixed(1)}/min over 5 min`}>
            {minute.responses}<em>/min</em>
          </Readout>
          <Readout label="Burn rate" note={`${formatCurrency(hour.cost)} in the last hour, list prices`}>
            {formatCurrency(five.cost * 12)}<em>/hr</em>
          </Readout>
        </div>
      </div>
      <Trace events={events} now={now} spanMs={spanMs} order={order} />
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
        <span className="lm-note">Tokens in the last {spanMinutes} min</span>
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
        <h2>Output speed</h2>
        <span className="lm-note">{current ? `≈${formatRate(current.median)} tok/s median, last 5 min` : "No timed responses yet"}</span>
      </header>
      <div className="lm-speed" ref={ref}>
        <svg width={width} height={height} role="img" aria-label={`Output speed of ${points.length} responses`}>
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
      <p className="lm-note">Dots are single responses, timed from the request to the last token. The line is the median of the 5 minutes before it.</p>
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
        <span className="lm-note">With a response in the last 15 min</span>
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
        <span className="lm-note">Newest first</span>
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
export function LiveBoard({ feed }: { feed: LiveFeed }) {
  const { data, series } = useDashboard();
  const [span, setSpan] = useState<Span>(15);
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
      <Header feed={feed} tool={tool} setTool={setTool} span={span} setSpan={setSpan} tools={tools} />
      <Instrument events={events} now={now} spanMs={spanMs} order={order} />
      <div className="lm-grid-3">
        <RankList title="By tool" rows={byTool} by="tool" spanMinutes={span} />
        <RankList title="By model" rows={byModel} by="model" spanMinutes={span} />
        <SpeedPanel events={events} now={now} spanMs={spanMs} />
      </div>
      <div className="lm-grid-2">
        <Sessions events={events} now={now} />
        <Feed events={events} />
      </div>
      <p className="lm-footnote">
        Following {feed.snapshot.files} {feed.snapshot.files === 1 ? "session file" : "session files"} from the last hour.
        {notFollowed.length > 0 && ` ${listFormat.format(notFollowed)} ${notFollowed.length === 1 ? "isn't" : "aren't"} followed live.`}
        {" "}Press Esc to leave Live mode.
      </p>
      <Limitations notFollowed={notFollowed} />
    </div>
  );
}

/** What Live mode can't see, so its numbers aren't read as the whole picture. */
function Limitations({ notFollowed }: { notFollowed: string[] }) {
  return (
    <details className="lm-limits">
      <summary>What Live mode can't see</summary>
      <ul>
        <li>
          <strong>Claude chats.</strong> Chats on claude.ai and in the Claude app aren't saved on this computer, so they never appear
          here. The plan meter is the only number that includes them.
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
        <li>
          <strong>Up-to-the-minute plan limits.</strong> The plan meter comes from a file the Claude app updates every 15 minutes or so,
          only while it is checking usage, and only for the account it checked last. The file isn't documented and could change.
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
