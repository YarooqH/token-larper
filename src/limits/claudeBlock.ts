import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ClaudeBlock } from "../types.ts";

const BLOCK_MS = 5 * 3600_000;
// A block can start up to 5h ago, and the one before it decides whether the gap rule applies.
const LOOKBACK_MS = 24 * 3600_000;

export interface ClaudeLogEntry {
  /** Response id; streamed responses repeat the same id across several lines. */
  id: string;
  tsMs: number;
  tokens: number;
}

/**
 * Claude Code starts a 5-hour session with the first message and a new one once that
 * window is over. This rebuilds the current session from local logs only, so it misses
 * anything sent from claude.ai or the desktop chat and is an estimate.
 */
export function computeClaudeBlock(entries: ClaudeLogEntry[], nowMs: number): ClaudeBlock | null {
  const byId = new Map<string, ClaudeLogEntry>();
  for (const e of entries) {
    if (!Number.isFinite(e.tsMs) || e.tsMs > nowMs) continue;
    const seen = byId.get(e.id);
    if (!seen || e.tokens > seen.tokens) byId.set(e.id, seen ? { ...e, tsMs: Math.min(e.tsMs, seen.tsMs) } : e);
  }
  const sorted = [...byId.values()].sort((a, b) => a.tsMs - b.tsMs);

  let current: { startMs: number; messages: number; tokens: number } | null = null;
  for (const e of sorted) {
    if (!current || e.tsMs >= current.startMs + BLOCK_MS) current = { startMs: e.tsMs, messages: 0, tokens: 0 };
    current.messages += 1;
    current.tokens += e.tokens;
  }
  if (!current || nowMs >= current.startMs + BLOCK_MS) return null;
  return {
    startsAt: new Date(current.startMs).toISOString(),
    endsAt: new Date(current.startMs + BLOCK_MS).toISOString(),
    messages: current.messages,
    tokens: current.tokens,
  };
}

export function parseClaudeLogLine(line: string): ClaudeLogEntry | null {
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return null;
  try {
    const obj = JSON.parse(line);
    if (obj?.type !== "assistant") return null;
    const usage = obj.message?.usage;
    const tsMs = Date.parse(obj.timestamp);
    if (!usage || !Number.isFinite(tsMs)) return null;
    const tokens =
      (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0);
    return { id: String(obj.message?.id ?? obj.requestId ?? obj.uuid ?? tsMs), tsMs, tokens };
  } catch {
    return null;
  }
}

async function recentJsonl(dir: string, minMtimeMs: number, out: string[]): Promise<void> {
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    items.map(async (item) => {
      const full = join(dir, item.name);
      if (item.isDirectory()) return recentJsonl(full, minMtimeMs, out);
      if (!item.name.endsWith(".jsonl")) return;
      try {
        if ((await stat(full)).mtimeMs >= minMtimeMs) out.push(full);
      } catch {
        // file vanished mid-scan
      }
    }),
  );
}

async function readEntries(path: string, minTsMs: number): Promise<ClaudeLogEntry[]> {
  const entries: ClaudeLogEntry[] = [];
  try {
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      const entry = parseClaudeLogLine(line);
      if (entry && entry.tsMs >= minTsMs) entries.push(entry);
    }
  } catch {
    // unreadable file: skip it
  }
  return entries;
}

export async function findCurrentClaudeBlock(nowMs: number = Date.now()): Promise<ClaudeBlock | null> {
  const configured = (process.env.CLAUDE_CONFIG_DIR ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const home = homedir();
  const roots = (configured.length ? configured : [join(home, ".config", "claude"), join(home, ".claude")]).map((d) => join(d, "projects"));

  const files: string[] = [];
  for (const root of roots) await recentJsonl(root, nowMs - LOOKBACK_MS, files);

  const all: ClaudeLogEntry[] = [];
  for (let i = 0; i < files.length; i += 4) {
    const batch = await Promise.all(files.slice(i, i + 4).map((f) => readEntries(f, nowMs - LOOKBACK_MS)));
    for (const found of batch) all.push(...found);
  }
  return computeClaudeBlock(all, nowMs);
}
