import { statSync } from "node:fs";
import { Database } from "bun:sqlite";
import type { HarnessId, LiveEvent, LiveSnapshot, LiveUpdate } from "../types.ts";
import { estimateFrontierCost } from "../ccusage.ts";
import { pricing } from "../pricing.ts";
import { resolveSessionProject } from "../projects.ts";
import { listSources } from "../throughput/index.ts";
import { antigravityStep } from "../throughput/readers.ts";
import { LIVE_TOOLS, parserFor, type LineParser, type LiveUsage } from "./parsers.ts";

// Follows the session files written to in the last hour and pushes each response to the
// open Live tabs as soon as it lands. It only runs while a Live tab is connected. Logs are
// read on from where the last read stopped; Antigravity's databases are queried for steps
// after the last one read. A quiet poll costs a stat or two per followed file.

export const LIVE_WINDOW_MS = 60 * 60_000;
const POLL_MS = 1000;
const DISCOVER_MS = 10_000;
/** Keeps following for a while after the last tab closes, so coming back is instant. */
const IDLE_STOP_MS = 30_000;
/** A file first seen above this size is read from its last part only. */
const BACKFILL_MAX_BYTES = 32 * 1024 * 1024;
/** Antigravity can fill in a step's usage after its row is written, so the last few are read again. */
const RECHECK_STEPS = 10;

interface Followed {
  path: string;
  harness: HarnessId;
  session?: string;
  /** For appended logs. */
  parser?: LineParser;
  /** Bytes read so far, always just past a newline; -1 before the first read. */
  offset: number;
  /** For databases: the size and time of the database and its write-ahead log at the last read. */
  dbSig?: string;
  /** For databases: the highest step index read. */
  lastStep?: number;
  /** For databases: the project folder's name, looked up once; "" when unknown. */
  project?: string;
}

type Listener = (update: LiveUpdate) => void;

const followed = new Map<string, Followed>();
const events = new Map<string, LiveEvent>();
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastDiscover = 0;
let idleSince: number | null = null;
let ready: Promise<void> | null = null;

/** Stores a response and marks it for sending, unless it is unchanged since the last read. */
function record(u: LiveUsage, changed: Map<string, LiveEvent>): void {
  const prev = events.get(u.id);
  if (prev && prev.at === u.at && prev.outputTokens === u.outputTokens && prev.inputTokens === u.inputTokens) return;
  const event: LiveEvent = { ...u, cost: estimateFrontierCost({ modelName: u.model, ...u }) };
  events.set(event.id, event);
  changed.set(event.id, event);
}

function fileSig(path: string): string {
  try {
    const s = statSync(path);
    return `${s.size}:${Math.round(s.mtimeMs)}`;
  } catch {
    return "-";
  }
}

/** The latest modified time among files that exist, or -Infinity. */
function lastWrite(paths: string[]): number {
  let latest = -Infinity;
  for (const p of paths) {
    try {
      latest = Math.max(latest, statSync(p).mtimeMs);
    } catch {
      // A write-ahead log only exists while the database is open.
    }
  }
  return latest;
}

/** Reads whole lines from offset to size; a line still being written waits for the next poll. */
async function readLines(path: string, offset: number, size: number): Promise<{ lines: string[]; next: number }> {
  const bytes = new Uint8Array(await Bun.file(path).slice(offset, size).arrayBuffer());
  const end = bytes.lastIndexOf(10);
  if (end < 0) return { lines: [], next: offset };
  return { lines: new TextDecoder().decode(bytes.subarray(0, end)).split("\n"), next: offset + end + 1 };
}

function discover(now: number): void {
  lastDiscover = now;
  const seen = new Set<string>();
  for (const source of listSources()) {
    if (!LIVE_TOOLS.includes(source.harness)) continue;
    // A database's own file can sit untouched for days while its write-ahead log grows.
    const mtime = lastWrite([source.path, ...(source.companions ?? [])]);
    // Files quiet for the whole window are dropped, and read again if they wake up.
    if (!(now - mtime <= LIVE_WINDOW_MS)) continue;
    seen.add(source.path);
    if (followed.has(source.path)) continue;
    const base = { path: source.path, harness: source.harness, session: source.session, offset: -1 };
    if (source.harness === "antigravity") {
      followed.set(source.path, { ...base, lastStep: -Infinity });
      continue;
    }
    const parser = parserFor(source.harness, source.path, source.session);
    if (parser) followed.set(source.path, { ...base, parser });
  }
  for (const path of followed.keys()) if (!seen.has(path)) followed.delete(path);
}

/** Steps added to an Antigravity conversation, or filled in, since the last read. */
function readAntigravity(f: Followed, cutoff: number, changed: Map<string, LiveEvent>): void {
  const sig = `${fileSig(f.path)}|${fileSig(`${f.path}-wal`)}`;
  if (sig === f.dbSig) return;
  f.dbSig = sig;
  const db = new Database(f.path, { readonly: true });
  try {
    const rows = db
      .query("select idx, metadata from steps where idx > ? order by idx")
      .all((f.lastStep ?? -Infinity) - RECHECK_STEPS) as { idx: number; metadata: unknown }[];
    for (const r of rows) {
      f.lastStep = Math.max(f.lastStep ?? -Infinity, r.idx);
      if (!(r.metadata instanceof Uint8Array)) continue;
      const step = antigravityStep(r.metadata);
      if (!step || step.end < cutoff) continue;
      if (f.project === undefined && f.session) f.project = resolveSessionProject("antigravity", f.session, "")?.name ?? "";
      record(
        {
          id: `antigravity:${f.session ?? f.path}:${r.idx}`,
          harness: "antigravity",
          model: step.model,
          start: step.start,
          at: step.end,
          ...(f.session ? { session: f.session } : {}),
          ...(f.project ? { project: f.project } : {}),
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
          cacheCreationTokens: 0,
          cacheReadTokens: step.cacheReadTokens,
          reasoningTokens: step.thinkingTokens,
        },
        changed,
      );
    }
  } finally {
    db.close();
  }
}

async function readLog(f: Followed, cutoff: number, changed: Map<string, LiveEvent>): Promise<void> {
  let size: number;
  try {
    size = statSync(f.path).size;
  } catch {
    followed.delete(f.path);
    return;
  }
  let partialFirstLine = false;
  if (f.offset < 0 || size < f.offset) {
    // New to us, or rewritten from the start: read it again with a fresh parser.
    f.parser = parserFor(f.harness, f.path, f.session) ?? f.parser;
    f.offset = Math.max(0, size - BACKFILL_MAX_BYTES);
    partialFirstLine = f.offset > 0;
  }
  if (size === f.offset || !f.parser) return;
  const { lines, next } = await readLines(f.path, f.offset, size);
  f.offset = next;
  for (const [i, line] of lines.entries()) {
    if (partialFirstLine && i === 0) continue;
    for (const u of f.parser.feed(line)) if (u.at >= cutoff) record(u, changed);
  }
}

async function poll(): Promise<LiveEvent[]> {
  const now = Date.now();
  if (now - lastDiscover >= DISCOVER_MS) discover(now);
  const cutoff = now - LIVE_WINDOW_MS;
  const changed = new Map<string, LiveEvent>();
  for (const f of [...followed.values()]) {
    try {
      if (f.harness === "antigravity") readAntigravity(f, cutoff, changed);
      else await readLog(f, cutoff, changed);
    } catch {
      // Locked, busy or deleted mid-read: the next poll tries again.
    }
  }
  for (const [id, e] of events) if (e.at < cutoff) events.delete(id);
  return [...changed.values()];
}

function schedule(): void {
  timer = setTimeout(async () => {
    timer = null;
    if (listeners.size === 0 && idleSince !== null && Date.now() - idleSince > IDLE_STOP_MS) return;
    const changed = await poll().catch(() => []);
    if (changed.length) {
      const update: LiveUpdate = { files: followed.size, events: changed };
      for (const listener of listeners) listener(update);
    }
    schedule();
  }, POLL_MS);
}

function start(): Promise<void> {
  idleSince = null;
  if (!ready) {
    // The first pass reads the last hour of every recent file before anything is sent. Costs
    // need the price list, which otherwise only loads with a usage refresh.
    lastDiscover = 0;
    ready = pricing.ensure().then(poll).then(() => undefined, () => undefined);
  }
  return ready.then(() => {
    if (!timer) schedule();
  });
}

export function liveSnapshot(): LiveSnapshot {
  const cutoff = Date.now() - LIVE_WINDOW_MS;
  return {
    windowMs: LIVE_WINDOW_MS,
    tools: LIVE_TOOLS,
    files: followed.size,
    events: [...events.values()].filter((e) => e.at >= cutoff),
  };
}

/** Calls onSnapshot once the last hour is read, then onUpdate with each batch of changes. */
export function subscribeLive(onSnapshot: (s: LiveSnapshot) => void, onUpdate: Listener): () => void {
  let active = true;
  void start().then(() => {
    if (!active) return;
    onSnapshot(liveSnapshot());
    listeners.add(onUpdate);
  });
  return () => {
    active = false;
    listeners.delete(onUpdate);
    if (listeners.size === 0) idleSince = Date.now();
  };
}

/** GET /api/live: Server-Sent Events, a "snapshot" first and then "update" messages. */
export function liveResponse(req: Request): Response {
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop();
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      write("retry: 3000\n\n");
      const unsubscribe = subscribeLive((s) => send("snapshot", s), (u) => send("update", u));
      // Comments keep the connection inside the server's idle timeout.
      const ping = setInterval(() => write(": ping\n\n"), 15_000);
      stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      req.signal.addEventListener("abort", () => stop());
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
