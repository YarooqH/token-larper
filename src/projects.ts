import { Database } from "bun:sqlite";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { HarnessId } from "./types.ts";
import { dataPath } from "./paths.ts";

// ccusage reports a usable project for only some harnesses, so the working directory is
// read from each harness's own session files. A session's cwd never changes, so found
// directories are also saved to disk; misses are retried once per process.

const HOME = homedir();
const cwdCache = new Map<string, string | null>();
const repoCache = new Map<string, string | null>();
const CACHE_FILE = dataPath("session-projects.json");
let diskLoaded = false;
let dirty = false;
let opencodeDirs: Map<string, { directory: string; updated: number }> | null = null;

export interface SessionProject {
  cwd: string;
  root: string;
  name: string;
}

function readHead(path: string, bytes = 64 * 1024): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.toString("utf8", 0, n);
  } finally {
    closeSync(fd);
  }
}

function firstCwd(path: string): string | null {
  if (!existsSync(path)) return null;
  const match = readHead(path).match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return match ? (JSON.parse(`"${match[1]}"`) as string) : null;
}

function loadOpencode(): Map<string, { directory: string; updated: number }> {
  if (opencodeDirs) return opencodeDirs;
  opencodeDirs = new Map();
  const dbPath = join(HOME, ".local", "share", "opencode", "opencode.db");
  if (!existsSync(dbPath)) return opencodeDirs;
  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.query("select id, directory, time_updated from session").all() as {
      id: string;
      directory: string | null;
      time_updated: number | null;
    }[];
    for (const r of rows) {
      if (r.directory) opencodeDirs.set(r.id, { directory: r.directory, updated: r.time_updated ?? 0 });
    }
    db.close();
  } catch {
    // An older OpenCode without the SQLite store, or a locked file: leave unattributed.
  }
  return opencodeDirs;
}

/** OpenCode sessions carry no timestamps in ccusage output; its own store has them. */
export function opencodeSessionUpdated(sessionId: string): number | null {
  return loadOpencode().get(sessionId)?.updated || null;
}

// The IDE, the CLI and older installs each keep their own store.
const ANTIGRAVITY_DIRS = ["antigravity", "antigravity-ide", "antigravity-cli"].map((d) => join(HOME, ".gemini", d));
let antigravityWorkspaces: Map<string, string> | null = null;

function fileUriToPath(uri: string): string | null {
  try {
    const path = decodeURIComponent(uri.replace(/^file:\/\/\//, ""));
    return /^[a-zA-Z]:\//.test(path) ? path : `/${path}`;
  } catch {
    return null;
  }
}

/** Antigravity lists workspaces for some conversations in its summary table. */
function loadAntigravityWorkspaces(): Map<string, string> {
  if (antigravityWorkspaces) return antigravityWorkspaces;
  antigravityWorkspaces = new Map();
  for (const dir of ANTIGRAVITY_DIRS) {
    const dbPath = join(dir, "conversation_summaries.db");
    if (!existsSync(dbPath)) continue;
    try {
      const db = new Database(dbPath, { readonly: true });
      const rows = db.query("select conversation_id, workspace_uris from conversation_summaries").all() as {
        conversation_id: string;
        workspace_uris: string;
      }[];
      for (const r of rows) {
        const first = (JSON.parse(r.workspace_uris || "[]") as string[])[0];
        const path = first ? fileUriToPath(first) : null;
        if (path) antigravityWorkspaces.set(r.conversation_id, path);
      }
      db.close();
    } catch {
      // Unknown schema: fall back to scanning the conversation itself.
    }
  }
  return antigravityWorkspaces;
}

/** Otherwise the conversation store mentions the files it touched; the most-referenced git repo wins. */
function scanAntigravityConversation(id: string): string | null {
  const file = ANTIGRAVITY_DIRS.flatMap((dir) => [".db", ".pb"].map((ext) => join(dir, "conversations", `${id}${ext}`))).find(existsSync);
  if (!file) return null;
  const dirCounts = new Map<string, number>();
  for (const [uri] of readHead(file, 4 * 1024 * 1024).matchAll(/file:\/\/\/[A-Za-z0-9%:/_.\-]+/g)) {
    const path = fileUriToPath(uri);
    if (!path || /\/\.gemini\//i.test(path)) continue;
    const dir = dirname(path);
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  for (const [dir, n] of dirCounts) {
    const repo = repoFor(dir);
    if (repo) counts.set(repo, (counts.get(repo) ?? 0) + n);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function lookupCwd(harness: HarnessId, sessionId: string, projectPath: string): string | null {
  switch (harness) {
    case "codex":
      return firstCwd(join(HOME, ".codex", "sessions", `${sessionId}.jsonl`));
    case "claude":
      return firstCwd(join(HOME, ".claude", "projects", projectPath, `${sessionId}.jsonl`));
    case "pi": {
      const dir = join(HOME, ".pi", "agent", "sessions", projectPath);
      if (!existsSync(dir)) return null;
      const file = readdirSync(dir).find((f) => f.endsWith(`_${sessionId}.jsonl`));
      return file ? firstCwd(join(dir, file)) : null;
    }
    case "opencode":
      return loadOpencode().get(sessionId)?.directory ?? null;
    case "antigravity":
      return loadAntigravityWorkspaces().get(sessionId) ?? scanAntigravityConversation(sessionId);
    default:
      return null;
  }
}

function normalize(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/.test(p) ? p[0]!.toUpperCase() + p.slice(1) : p;
}

/** The nearest ancestor holding a .git folder. Every folder visited is memoized, so a
 *  directory tree is only probed once however many files point into it. */
function repoFor(dir: string, depth = 0): string | null {
  const key = dir.toLowerCase();
  const cached = repoCache.get(key);
  if (cached !== undefined) return cached;
  let repo: string | null = null;
  if (existsSync(join(dir, ".git"))) repo = dir;
  else {
    const parent = dirname(dir);
    if (parent !== dir && depth < 12) repo = repoFor(parent, depth + 1);
  }
  repoCache.set(key, repo);
  return repo;
}

function loadDiskCache(): void {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const saved = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, string>;
    for (const [key, cwd] of Object.entries(saved)) cwdCache.set(key, cwd);
  } catch {
    // First run or a damaged file: everything is looked up again.
  }
}

/** Persist newly found directories; called after each dashboard rebuild. */
export function saveSessionProjects(): void {
  if (!dirty) return;
  dirty = false;
  const found = Object.fromEntries([...cwdCache].filter((entry): entry is [string, string] => entry[1] !== null));
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(found), "utf8");
  } catch {
    // The cache is only an optimization.
  }
}

export function resolveSessionProject(
  harness: HarnessId,
  sessionId: string,
  projectPath: string
): SessionProject | null {
  loadDiskCache();
  const key = `${harness}:${sessionId}`;
  let cwd = cwdCache.get(key);
  if (cwd === undefined) {
    try {
      cwd = lookupCwd(harness, sessionId, projectPath);
    } catch {
      cwd = null;
    }
    cwdCache.set(key, cwd);
    if (cwd) dirty = true;
  }
  if (!cwd) return null;
  // Group sessions by repository, falling back to the working directory itself.
  const root = normalize(repoFor(cwd) ?? cwd);
  return { cwd: normalize(cwd), root, name: basename(root) || root };
}
