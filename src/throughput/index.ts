import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ActivityRow, HarnessId, ThroughputPayload, ThroughputRow } from "../types.ts";
import { dataPath } from "../paths.ts";
import {
  readAntigravity,
  readClaude,
  readCodex,
  readCopilotEvents,
  readCopilotOtel,
  readGemini,
  readOpencode,
  readPi,
  type FileResult,
} from "./readers.ts";
import { activityByDay, mergeIntervals, rowsFromSamples, type Interval } from "./stats.ts";

// ccusage only reports totals, so speed is read from each tool's own session files. The
// first pass reads every file, which can take a while for gigabytes of Codex rollouts, so it
// runs in the background and saves what it found per file; later passes only re-read files
// whose size or modified time changed.

const HOME = homedir();
const CACHE_FILE = dataPath("throughput-cache.json");
const CACHE_VERSION = 1;
const RESCAN_AFTER_MS = 60_000;

/** Tools that record when each request was sent and finished, rather than leaving it to log order. */
export const TIMED_BY_TOOL: HarnessId[] = ["opencode", "pi", "antigravity", "copilot"];

interface Source {
  harness: HarnessId;
  path: string;
  read: (path: string) => FileResult | Promise<FileResult>;
  /** Extra files whose changes mean this one must be read again (SQLite's write-ahead log). */
  companions?: string[];
}

interface CachedFile {
  sig: string;
  harness: HarnessId;
  rows: ThroughputRow[];
  intervals: Interval[];
}

const text = (fn: (t: string) => FileResult) => async (path: string) => fn(await Bun.file(path).text());

function walk(dir: string, keep: (name: string) => boolean, depth = 6, out: string[] = []): string[] {
  if (depth < 0) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, depth - 1, out);
    else if (keep(e.name)) out.push(p);
  }
  return out;
}

const envDirs = (name: string) =>
  (process.env[name] ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

function claudeSources(): Source[] {
  const roots = envDirs("CLAUDE_CONFIG_DIR");
  const dirs = (roots.length ? roots : [join(HOME, ".config", "claude"), join(HOME, ".claude")]).map((d) => join(d, "projects"));
  return dirs.flatMap((d) => walk(d, (n) => n.endsWith(".jsonl"))).map((path) => ({ harness: "claude", path, read: text(readClaude) }));
}

function codexSources(): Source[] {
  const home = process.env.CODEX_HOME || join(HOME, ".codex");
  return [join(home, "sessions"), join(home, "archived_sessions")]
    .flatMap((d) => walk(d, (n) => n.endsWith(".jsonl")))
    .map((path) => ({ harness: "codex", path, read: text(readCodex) }));
}

function piSources(): Source[] {
  return walk(join(HOME, ".pi", "agent", "sessions"), (n) => n.endsWith(".jsonl")).map((path) => ({
    harness: "pi",
    path,
    read: text(readPi),
  }));
}

function geminiSources(): Source[] {
  return walk(join(HOME, ".gemini", "tmp"), (n) => n.startsWith("session-") && /\.jsonl?$/.test(n), 3)
    .filter((p) => /[\\/]chats[\\/]/.test(p))
    .map((path) => ({ harness: "gemini", path, read: text(readGemini) }));
}

function copilotSources(): Source[] {
  const home = process.env.COPILOT_HOME || join(HOME, ".copilot");
  const otel = walk(join(home, "otel"), (n) => n.endsWith(".jsonl"));
  const exporter = process.env.COPILOT_OTEL_FILE_EXPORTER_PATH;
  if (exporter && existsSync(exporter) && !otel.includes(exporter)) otel.push(exporter);
  const events = walk(join(home, "session-state"), (n) => n === "events.jsonl", 1);
  return [
    ...otel.map((path): Source => ({ harness: "copilot", path, read: text(readCopilotOtel) })),
    ...events.map((path): Source => ({ harness: "copilot", path, read: text(readCopilotEvents) })),
  ];
}

function opencodeSources(): Source[] {
  const path = join(process.env.XDG_DATA_HOME || join(HOME, ".local", "share"), "opencode", "opencode.db");
  return existsSync(path) ? [{ harness: "opencode", path, read: readOpencode, companions: [`${path}-wal`] }] : [];
}

function antigravitySources(): Source[] {
  const configured = envDirs("ANTIGRAVITY_DATA_DIR");
  const roots = configured.length
    ? configured.map((d) => (existsSync(join(d, "conversations")) ? join(d, "conversations") : d))
    : [
        join(HOME, ".gemini", "antigravity", "conversations"),
        join(HOME, ".gemini", "antigravity-cli", "conversations"),
        join(HOME, ".gemini", "antigravity-ide", "conversations"),
        join(HOME, ".gemini", "antigravity-backup", "conversations"),
        join(HOME, ".config", "antigravity", "conversations"),
      ];
  return roots
    .flatMap((d) => walk(d, (n) => n.endsWith(".db"), 0))
    .map((path) => ({ harness: "antigravity", path, read: readAntigravity, companions: [`${path}-wal`] }));
}

function listSources(): Source[] {
  return [
    ...claudeSources(),
    ...codexSources(),
    ...piSources(),
    ...geminiSources(),
    ...copilotSources(),
    ...opencodeSources(),
    ...antigravitySources(),
  ];
}

function signature(source: Source): string | null {
  try {
    const parts = [source.path, ...(source.companions ?? [])].map((p) => {
      if (!existsSync(p)) return "-";
      const s = statSync(p);
      return `${s.size}:${Math.round(s.mtimeMs)}`;
    });
    return parts[0] === "-" ? null : parts.join("|");
  } catch {
    return null;
  }
}

let files = new Map<string, CachedFile>();
let diskLoaded = false;
let payload: ThroughputPayload | null = null;
let scanning: Promise<void> | null = null;
let lastScanAt = 0;

function loadDisk(): void {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const saved = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (saved?.version === CACHE_VERSION && saved.files) {
      files = new Map(Object.entries(saved.files as Record<string, CachedFile>));
      payload = build("ready", saved.scannedAt ?? null);
    }
  } catch {
    // No cache yet, or an unreadable one: the first scan rebuilds it.
  }
}

function saveDisk(scannedAt: string): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify({ version: CACHE_VERSION, scannedAt, files: Object.fromEntries(files) }), "utf8");
  } catch {
    // The data folder may be read-only; the next start just scans again.
  }
}

function build(status: ThroughputPayload["status"], scannedAt: string | null): ThroughputPayload {
  const rows = new Map<string, ThroughputRow>();
  const intervals = new Map<HarnessId, Interval[]>();
  for (const f of files.values()) {
    for (const r of f.rows) {
      const key = `${r.day}\n${r.harness}\n${r.model}`;
      const into = rows.get(key);
      if (!into) {
        rows.set(key, { ...r, hist: { ...r.hist } });
        continue;
      }
      into.responses += r.responses;
      into.outputTokens += r.outputTokens;
      into.ms += r.ms;
      for (const [bin, n] of Object.entries(r.hist)) into.hist[Number(bin)] = (into.hist[Number(bin)] ?? 0) + n;
    }
    const list = intervals.get(f.harness) ?? [];
    for (const i of f.intervals) list.push([i[0], i[1]]);
    intervals.set(f.harness, list);
  }
  const activity: ActivityRow[] = [];
  for (const [harness, list] of intervals) activity.push(...activityByDay(harness, mergeIntervals(list)));
  return { status, scannedAt, timedByTool: TIMED_BY_TOOL, rows: [...rows.values()], activity };
}

async function scan(): Promise<void> {
  const sources = listSources();
  const live = new Set<string>();
  for (const source of sources) {
    live.add(source.path);
    const sig = signature(source);
    if (!sig || files.get(source.path)?.sig === sig) continue;
    try {
      const result = await source.read(source.path);
      const spans: Interval[] = result.samples.map((s) => [s.start, s.end]);
      files.set(source.path, {
        sig,
        harness: source.harness,
        rows: rowsFromSamples(source.harness, result.samples),
        intervals: mergeIntervals([...spans, ...(result.activity ?? [])]),
      });
    } catch {
      // Locked, deleted mid-scan, or unreadable: try again next pass.
    }
    // Parsing is synchronous, so give the server a turn between files.
    await Bun.sleep(0);
  }
  for (const path of files.keys()) if (!live.has(path)) files.delete(path);
  const scannedAt = new Date().toISOString();
  payload = build("ready", scannedAt);
  saveDisk(scannedAt);
}

function startScan(): Promise<void> {
  if (scanning) return scanning;
  lastScanAt = Date.now();
  const run = scan().finally(() => {
    scanning = null;
  });
  scanning = run;
  return run;
}

/**
 * The latest speeds, starting a rescan when they are more than a minute old. With waitMs,
 * waits up to that long for the scan, so a dashboard refresh gets current numbers.
 */
export async function getThroughput(waitMs = 0): Promise<ThroughputPayload> {
  loadDisk();
  if (!scanning && Date.now() - lastScanAt > RESCAN_AFTER_MS) void startScan();
  if (scanning && waitMs > 0) await Promise.race([scanning, Bun.sleep(waitMs)]);
  return payload ?? { status: "scanning", scannedAt: null, timedByTool: TIMED_BY_TOOL, rows: [], activity: [] };
}

/** Runs a full pass and waits for it; for tests and scripts. */
export async function scanThroughputNow(): Promise<ThroughputPayload> {
  loadDisk();
  await startScan();
  return payload!;
}
