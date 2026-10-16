import { Database } from "bun:sqlite";
import { createDecipheriv } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { dataPath } from "../paths.ts";
import { findCurrentClaudeBlock } from "./claudeBlock.ts";
import type { HarnessLimitCard, LimitsPayload, QuotaWindow, QuotaWindowStatus } from "../types.ts";

const CACHE_FILE = dataPath("limits-cache.json");
// Under the client's 60s poll so every poll gets fresh data.
const CACHE_TTL_MS = 45_000;
// Forced (refresh=1) calls inside this window get the cached payload, so spamming Sync can't hammer vendors.
const MIN_FORCED_REFRESH_MS = 10_000;
const HTTP_TIMEOUT_MS = 4_500;
// One slow provider must not delay the others; a timeout counts as a failed fetch.
const PROVIDER_TIMEOUT_MS = 8_000;
// A carried-over card older than this is dropped instead of shown as stale forever.
// Quota readings go wrong quickly (a 5h window can fully roll over), so an old snapshot is worse than none.
const STALE_MAX_AGE_MS = 15 * 60_000;
const CREDENTIAL_TTL_MS = 10 * 60_000;

// OpenCode Go list values. These are NOT read from the vendor: keep the plan price, rolling
// dollar caps and per-model rates in sync with the published OpenCode Go plan by hand.
export const OPENCODE_GO_LIST_VALUES = {
  planName: "OpenCode Go",
  caps: [
    { id: "five_hour", label: "5-hour window", seconds: 5 * 3600, limitUsd: 12 },
    { id: "seven_day", label: "7-day weekly", seconds: 7 * 86400, limitUsd: 30 },
    { id: "thirty_day", label: "30-day monthly", seconds: 30 * 86400, limitUsd: 60 },
  ],
  // Per-1M token list rates: [input, output, cacheWrite, cacheRead]
  rates: {
    "glm-5.1": [1.4, 4.4, 0, 0.26],
    "glm-5": [1.0, 3.2, 0, 0.2],
    "kimi-k2.5": [0.6, 3.0, 0, 0.1],
    "mimo-v2-pro": [1.0, 3.0, 0, 0.2],
    "mimo-v2-omni": [0.4, 2.0, 0, 0.08],
    "minimax-m2.7": [0.3, 1.2, 0, 0.06],
    "minimax-m2.5": [0.3, 1.2, 0, 0.03],
    "qwen3.5-plus": [0.4, 2.4, 0, 0.08],
    "qwen3.6-plus": [0.5, 3.0, 0, 0.1],
  } as Record<string, [number, number, number, number]>,
} as const;
const OPENCODE_GO_RATES = OPENCODE_GO_LIST_VALUES.rates;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function getWindowStatus(remainingPercent: number): QuotaWindowStatus {
  if (remainingPercent <= 5) return "critical";
  if (remainingPercent <= 20) return "warning";
  return "ok";
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Per-key cache that also remembers null results and runs `fn` once at a time per key.
export function memoizeAsyncTtl<T>(
  fn: (key: string) => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): (key: string) => Promise<T> {
  const done = new Map<string, { value: T; expiresAt: number }>();
  const pending = new Map<string, Promise<T>>();
  return (key) => {
    const hit = done.get(key);
    if (hit && hit.expiresAt > now()) return Promise.resolve(hit.value);
    const running = pending.get(key);
    if (running) return running;
    const next = fn(key)
      .then((value) => {
        done.set(key, { value, expiresAt: now() + ttlMs });
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, next);
    return next;
  };
}

interface SessionFile {
  path: string;
  mtimeMs: number;
  size: number;
}

// Async walk for *.jsonl. `newestNameFirst` visits names in descending order (date-named dirs/files)
// and stops once `limit` files are collected, so huge archives are never fully statted.
async function collectJsonlFiles(
  root: string,
  opts: { newestNameFirst?: boolean; limit?: number; minMtimeMs?: number; maxDepth?: number },
): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  const maxDepth = opts.maxDepth ?? 5;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || (opts.limit !== undefined && files.length >= opts.limit)) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (opts.newestNameFirst) entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));

    const stats = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
        .map(async (e) => {
          const path = join(dir, e.name);
          try {
            const st = await stat(path);
            return { path, mtimeMs: st.mtimeMs, size: st.size };
          } catch {
            return null;
          }
        }),
    );
    for (const f of stats) {
      if (f && (opts.minMtimeMs === undefined || f.mtimeMs >= opts.minMtimeMs)) files.push(f);
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name), depth + 1);
    }
  };
  await walk(root, 0);
  return files;
}

async function readFileTail(path: string, bytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    await handle.close();
  }
}

// ============================================================================
// 1. Claude Code (OAuth Usage API, read-only access token)
// ============================================================================

export interface ClaudeOAuthUsageResponse {
  five_hour?: { utilization?: number; resets_at?: string | null } | null;
  seven_day?: { utilization?: number; resets_at?: string | null } | null;
  seven_day_opus?: { utilization?: number; resets_at?: string | null } | null;
  seven_day_sonnet?: { utilization?: number; resets_at?: string | null } | null;
  seven_day_oauth_apps?: { utilization?: number; resets_at?: string | null } | null;
  seven_day_cowork?: { utilization?: number; resets_at?: string | null } | null;
  seven_day_breakdown?: {
    rows?: { key?: string; display_name?: string; percent?: number }[];
  } | null;
  extra_usage?: {
    is_enabled?: boolean;
    monthly_limit?: number | null;
    used_credits?: number | null;
    utilization?: number | null;
  } | null;
  [key: string]: unknown;
}

export function formatClaudePlanName(subscriptionType?: string | null, rateLimitTier?: string | null): string {
  const sub = (subscriptionType || "").toLowerCase();
  const tier = (rateLimitTier || "").toLowerCase();
  let base = "Claude";
  if (sub === "max") base = "Claude Max";
  else if (sub === "pro") base = "Claude Pro";
  else if (sub === "team") base = "Claude Team";
  else if (sub === "enterprise") base = "Claude Enterprise";
  else if (sub) base = `Claude ${sub.charAt(0).toUpperCase()}${sub.slice(1)}`;

  const multMatch = tier.match(/(\d+x)/i);
  if (multMatch) return `${base} (${multMatch[1].toLowerCase()})`;
  return base;
}

export function decodeJwtPayload(jwt: string | null | undefined): Record<string, unknown> | null {
  if (!jwt || typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseClaudeOAuthUsage(
  raw: ClaudeOAuthUsageResponse,
  meta?: {
    id?: string;
    account?: string;
    subscriptionType?: string | null;
    rateLimitTier?: string | null;
    updatedAt?: string;
  },
): HarnessLimitCard {
  const windows: QuotaWindow[] = [];

  const pushWindow = (
    id: string,
    label: string,
    sublabel: string | undefined,
    bucket: { utilization?: number; resets_at?: string | null } | null | undefined,
    windowSeconds?: number,
  ) => {
    if (!bucket || typeof bucket.utilization !== "number") return;
    const usedPercent = clampPercent(bucket.utilization);
    const remainingPercent = clampPercent(100 - usedPercent);
    windows.push({
      id,
      label,
      sublabel,
      usedPercent,
      remainingPercent,
      resetsAt: bucket.resets_at || null,
      windowSeconds,
      status: getWindowStatus(remainingPercent),
    });
  };

  pushWindow("five_hour", "5-hour window", "Rolling 5h block", raw.five_hour, 5 * 3600);
  pushWindow("seven_day", "7-day weekly", "All models", raw.seven_day, 7 * 86400);
  pushWindow("seven_day_opus", "7-day Opus", "Opus weekly cap", raw.seven_day_opus, 7 * 86400);
  pushWindow("seven_day_sonnet", "7-day Sonnet", "Sonnet weekly cap", raw.seven_day_sonnet, 7 * 86400);

  const credits: NonNullable<HarnessLimitCard["credits"]> = [];

  // Promotional / gift dollar buckets (e.g. iguana_necktie or similar dynamic keys)
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const rec = val as Record<string, unknown>;
    if (typeof rec.limit_dollars === "number" && typeof rec.remaining_dollars === "number") {
      const usedDollars = typeof rec.used_dollars === "number" ? rec.used_dollars : rec.limit_dollars - rec.remaining_dollars;
      credits.push({
        label: key === "iguana_necktie" ? "Promo credit" : "Bonus credit",
        remainingText: `${formatUsd(rec.remaining_dollars)} left`,
        usedText: formatUsd(usedDollars),
        limitText: formatUsd(rec.limit_dollars),
        resetsAt: typeof rec.resets_at === "string" ? rec.resets_at : null,
      });
    }
  }

  if (raw.extra_usage?.is_enabled && typeof raw.extra_usage.monthly_limit === "number" && raw.extra_usage.monthly_limit > 0) {
    const limitDollars = raw.extra_usage.monthly_limit / 100;
    const usedDollars = (raw.extra_usage.used_credits ?? 0) / 100;
    const remDollars = Math.max(0, limitDollars - usedDollars);
    credits.push({
      label: "Extra usage cap",
      remainingText: `${formatUsd(remDollars)} left`,
      usedText: formatUsd(usedDollars),
      limitText: formatUsd(limitDollars),
    });
  }

  const breakdownRows = raw.seven_day_breakdown?.rows?.filter(
    (r): r is { display_name: string; percent: number } =>
      typeof r?.display_name === "string" && typeof r?.percent === "number" && r.percent > 0,
  );

  return {
    id: meta?.id || "claude",
    harness: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    account: meta?.account,
    planName: formatClaudePlanName(meta?.subscriptionType, meta?.rateLimitTier),
    source: "live",
    sourceLabel: "Anthropic OAuth",
    updatedAt: meta?.updatedAt ?? new Date().toISOString(),
    windows,
    credits: credits.length > 0 ? credits : undefined,
    breakdown:
      breakdownRows && breakdownRows.length > 0
        ? {
            label: "7-day usage by surface",
            items: breakdownRows.map((r) => ({ name: r.display_name, percent: clampPercent(r.percent) })),
          }
        : undefined,
  };
}

interface ClaudeOAuthCredentials {
  accessToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
  rateLimitTier?: string;
  account?: string;
  accountUuid?: string;
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: ClaudeOAuthCredentials;
}

export const CLAUDE_SIGN_IN_EXPIRED_MESSAGE = "Claude sign-in expired. Open Claude Code once to refresh it";

// Card-less state for an expired/rejected token. We never refresh it ourselves: rotating the
// refresh token would race the running Claude Code and could sign the user out of it.
export function buildClaudeSignInExpiredCard(
  meta?: { id?: string; account?: string; subscriptionType?: string | null; rateLimitTier?: string | null },
  updatedAt?: string,
): HarnessLimitCard {
  return {
    id: meta?.id || "claude",
    harness: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    account: meta?.account,
    planName: formatClaudePlanName(meta?.subscriptionType, meta?.rateLimitTier),
    source: "live",
    sourceLabel: "Anthropic OAuth",
    updatedAt: updatedAt ?? new Date().toISOString(),
    windows: [],
    error: CLAUDE_SIGN_IN_EXPIRED_MESSAGE,
  };
}

function readClaudeAccountMeta(dirOrFile: string): { email?: string; accountUuid?: string; orgUuid?: string } {
  const candidates = dirOrFile.endsWith(".json") ? [dirOrFile] : [join(dirOrFile, ".claude.json")];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      const oa = j?.oauthAccount;
      if (oa && typeof oa === "object") {
        return {
          email: typeof oa.emailAddress === "string" ? oa.emailAddress : undefined,
          accountUuid: typeof oa.accountUuid === "string" ? oa.accountUuid : undefined,
          orgUuid: typeof oa.organizationUuid === "string" ? oa.organizationUuid : undefined,
        };
      }
    } catch {
      // ignore
    }
  }
  return {};
}

function listClaudeDesktopDirs(): string[] {
  const home = homedir();
  const dirs: string[] = [];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    if (existsSync(join(appData, "Claude"))) dirs.push(join(appData, "Claude"));
    const pkgsDir = join(localAppData, "Packages");
    try {
      for (const name of readdirSync(pkgsDir)) {
        if (name.toLowerCase().startsWith("claude_")) {
          const roam = join(pkgsDir, name, "LocalCache", "Roaming", "Claude");
          if (existsSync(roam)) dirs.push(roam);
        }
      }
    } catch {
      // ignore
    }
  } else if (process.platform === "darwin") {
    const p = join(home, "Library", "Application Support", "Claude");
    if (existsSync(p)) dirs.push(p);
  } else {
    const p = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "Claude");
    if (existsSync(p)) dirs.push(p);
  }
  return dirs;
}

async function readClaudeDesktopOAuthCredentials(
  emailByUuid: ReadonlyMap<string, string>,
  defaultEmail?: string,
): Promise<ClaudeOAuthCredentials[]> {
  if (process.platform !== "win32") return [];
  const results: ClaudeOAuthCredentials[] = [];
  for (const dir of listClaudeDesktopDirs()) {
    const cfgPath = join(dir, "config.json");
    const localStatePath = join(dir, "Local State");
    if (!existsSync(cfgPath) || !existsSync(localStatePath)) continue;
    try {
      const localState = JSON.parse(readFileSync(localStatePath, "utf8"));
      const encKeyB64 = localState?.os_crypt?.encrypted_key;
      if (typeof encKeyB64 !== "string") continue;
      const rawKey = Buffer.from(encKeyB64, "base64");
      if (rawKey.length <= 5 || rawKey.subarray(0, 5).toString("utf8") !== "DPAPI") continue;
      const masterKey = await decryptWindowsDpapi(rawKey.subarray(5).toString("base64"));
      if (!masterKey || masterKey.length !== 32) continue;

      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      const byAccount = new Map<string, ClaudeOAuthCredentials>();
      for (const field of ["oauth:tokenCacheV2", "oauth:tokenCache"]) {
        const b64 = cfg?.[field];
        if (typeof b64 !== "string" || !b64) continue;
        const buf = Buffer.from(b64, "base64");
        if (buf.length < 31 || buf.subarray(0, 3).toString("utf8") !== "v10") continue;
        const nonce = buf.subarray(3, 15);
        const tag = buf.subarray(buf.length - 16);
        const ct = buf.subarray(15, buf.length - 16);
        const decipher = createDecipheriv("aes-256-gcm", masterKey, nonce);
        decipher.setAuthTag(tag);
        const parsed = JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8"));
        if (!parsed || typeof parsed !== "object") continue;

        for (const [k, v] of Object.entries(parsed as Record<string, Record<string, unknown>>)) {
          if (!v || typeof v.token !== "string" || !v.token) continue;
          // Key format: acct:<accountUuid>|<clientId>:<orgUuid>:...
          const acctMatch = k.match(/^acct:([^|:]+)\|[^:]+:([^:]+):/);
          const accountUuid = acctMatch?.[1] || (typeof cfg.lastKnownAccountUuid === "string" ? cfg.lastKnownAccountUuid : "default");
          const orgUuid = acctMatch?.[2];
          const groupKey = `${accountUuid}:${orgUuid || ""}`;
          const email = emailByUuid.get(accountUuid) || (orgUuid ? emailByUuid.get(orgUuid) : undefined) || defaultEmail;
          const candidate: ClaudeOAuthCredentials = {
            accessToken: v.token,
            expiresAt: typeof v.expiresAt === "number" ? v.expiresAt : undefined,
            subscriptionType: typeof v.subscriptionType === "string" ? v.subscriptionType : undefined,
            rateLimitTier: typeof v.rateLimitTier === "string" ? v.rateLimitTier : undefined,
            account: email,
            accountUuid: groupKey,
          };
          const prev = byAccount.get(groupKey);
          if (
            !prev ||
            (!prev.subscriptionType && candidate.subscriptionType) ||
            (!!candidate.subscriptionType === !!prev.subscriptionType && (candidate.expiresAt ?? 0) > (prev.expiresAt ?? 0))
          ) {
            byAccount.set(groupKey, candidate);
          }
        }
      }
      results.push(...byAccount.values());
    } catch {
      // ignore unreadable or undecryptable desktop config
    }
  }
  return results;
}

async function readAllClaudeOAuthCredentials(): Promise<ClaudeOAuthCredentials[]> {
  const home = homedir();
  const emailByUuid = new Map<string, string>();
  const rootMeta = readClaudeAccountMeta(join(home, ".claude.json"));
  if (rootMeta.email && rootMeta.accountUuid) emailByUuid.set(rootMeta.accountUuid, rootMeta.email);
  if (rootMeta.email && rootMeta.orgUuid) emailByUuid.set(rootMeta.orgUuid, rootMeta.email);

  const dirs = new Set<string>();
  const configured = (process.env.CLAUDE_CONFIG_DIR ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  for (const d of configured) dirs.add(d);
  dirs.add(join(home, ".claude"));
  dirs.add(join(home, ".config", "claude"));
  try {
    for (const entry of readdirSync(home)) {
      if (entry.startsWith(".claude") && entry !== ".claude.json" && !entry.startsWith(".claude.json.")) {
        dirs.add(join(home, entry));
      }
    }
  } catch {
    // ignore
  }

  const cliCreds: ClaudeOAuthCredentials[] = [];
  for (const dir of dirs) {
    const meta = readClaudeAccountMeta(dir);
    if (meta.email && meta.accountUuid) emailByUuid.set(meta.accountUuid, meta.email);
    if (meta.email && meta.orgUuid) emailByUuid.set(meta.orgUuid, meta.email);
    const credPath = join(dir, ".credentials.json");
    if (existsSync(credPath)) {
      try {
        const file = JSON.parse(readFileSync(credPath, "utf8")) as ClaudeCredentialsFile;
        if (file.claudeAiOauth?.accessToken) {
          cliCreds.push({
            ...file.claudeAiOauth,
            account: meta.email || rootMeta.email,
            accountUuid: meta.accountUuid ? `${meta.accountUuid}:${meta.orgUuid || ""}` : undefined,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  const desktopCreds = await readClaudeDesktopOAuthCredentials(emailByUuid, rootMeta.email);

  // macOS keeps Claude Code credentials in the login keychain instead of a file.
  if (process.platform === "darwin") {
    const raw = await readKeychainSecret("Claude Code-credentials");
    if (raw) {
      try {
        const file = JSON.parse(raw) as ClaudeCredentialsFile;
        if (file.claudeAiOauth?.accessToken) {
          cliCreds.push({ ...file.claudeAiOauth, account: rootMeta.email });
        }
      } catch {
        // ignore malformed keychain item
      }
    }
  }

  const piAuthPath = join(home, ".pi", "agent", "auth.json");
  if (existsSync(piAuthPath)) {
    try {
      const piAuth = JSON.parse(readFileSync(piAuthPath, "utf8"));
      if (piAuth?.anthropic?.access) {
        cliCreds.push({
          accessToken: piAuth.anthropic.access,
          expiresAt: piAuth.anthropic.expires,
          account: rootMeta.email,
        });
      }
    } catch {
      // ignore
    }
  }

  // Merge Desktop and CLI credentials, deduplicating by account/email/token and preferring valid tokens over expired ones.
  const now = Date.now();
  const isFresh = (c: ClaudeOAuthCredentials) => typeof c.expiresAt !== "number" || c.expiresAt > now;
  const merged = new Map<string, ClaudeOAuthCredentials>();

  for (const cred of [...desktopCreds, ...cliCreds]) {
    if (!cred.accessToken) continue;
    const key = (cred.account || cred.accountUuid || cred.accessToken).toLowerCase();
    const existing = merged.get(key);
    if (!existing || (!isFresh(existing) && isFresh(cred))) {
      merged.set(key, cred);
    }
  }

  // If we have at least one valid credential and another entry has no account identifier and is expired, drop the orphan expired entry.
  const list = [...merged.values()];
  if (list.some(isFresh)) {
    return list.filter((c) => isFresh(c) || !!c.account);
  }
  return list;
}

const CLAUDE_BACKOFF_DEFAULT_MS = 5 * 60_000;
let claudeBackoffUntilMs = 0;
// Why a provider returned nothing this round; read once by collectAllLimits to explain an unavailable card.
const failureReasons = new Map<string, string>();

async function fetchClaudeLimitsForCredential(
  oauth: ClaudeOAuthCredentials,
  cardId: string,
): Promise<HarnessLimitCard | null> {
  if (!oauth?.accessToken) return null;
  const meta = {
    id: cardId,
    account: oauth.account,
    subscriptionType: oauth.subscriptionType,
    rateLimitTier: oauth.rateLimitTier,
  };

  if (typeof oauth.expiresAt === "number" && Date.now() >= oauth.expiresAt) {
    return buildClaudeSignInExpiredCard(meta);
  }
  if (Date.now() < claudeBackoffUntilMs) {
    failureReasons.set("claude", "Anthropic is rate-limiting the usage lookup");
    return null;
  }

  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.5",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (res.status === 401) return buildClaudeSignInExpiredCard(meta);
    if (res.status === 429) {
      // This endpoint rate-limits hard; back off instead of retrying every poll.
      const retryAfterS = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS * 1000 : CLAUDE_BACKOFF_DEFAULT_MS;
      claudeBackoffUntilMs = Date.now() + Math.min(waitMs, 30 * 60_000);
      failureReasons.set("claude", "Anthropic is rate-limiting the usage lookup");
      return null;
    }
    if (!res.ok) {
      failureReasons.set("claude", `Anthropic usage lookup failed (${res.status})`);
      return null;
    }
    const data = (await res.json()) as ClaudeOAuthUsageResponse;
    return parseClaudeOAuthUsage(data, meta);
  } catch {
    return null;
  }
}

// ============================================================================
// 2. OpenAI Codex CLI (Live wham/usage + Local rollout-*.jsonl fallback)
// ============================================================================

export interface CodexWhamUsageResponse {
  plan_type?: string;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: {
      used_percent?: number;
      limit_window_seconds?: number;
      reset_after_seconds?: number;
      reset_at?: number;
    } | null;
    secondary_window?: {
      used_percent?: number;
      limit_window_seconds?: number;
      reset_after_seconds?: number;
      reset_at?: number;
    } | null;
  } | null;
  code_review_rate_limit?: {
    primary_window?: {
      used_percent?: number;
      limit_window_seconds?: number;
      reset_at?: number;
    } | null;
  } | null;
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: string | number | null;
  } | null;
}

export interface CodexRolloutRateLimits {
  plan_type?: string | null;
  primary?: {
    used_percent?: number;
    window_minutes?: number;
    resets_at?: number;
  } | null;
  secondary?: {
    used_percent?: number;
    window_minutes?: number;
    resets_at?: number;
  } | null;
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: string | number | null;
  } | null;
}

function describeWindowSeconds(seconds?: number): { label: string; sublabel: string } {
  if (!seconds) return { label: "Primary window", sublabel: "Rolling limit" };
  if (seconds === 18_000) return { label: "5-hour window", sublabel: "Rolling 5h limit" };
  if (seconds === 604_800) return { label: "7-day weekly", sublabel: "Rolling 7d limit" };
  if (seconds === 2_592_000) return { label: "30-day monthly", sublabel: "Rolling 30d limit" };
  const hours = Math.round(seconds / 3600);
  if (hours < 48) return { label: `${hours}-hour window`, sublabel: `Rolling ${hours}h limit` };
  const days = Math.round(seconds / 86400);
  return { label: `${days}-day window`, sublabel: `Rolling ${days}d limit` };
}

function formatCodexPlan(planType?: string | null): string {
  const p = (planType || "").toLowerCase();
  if (p === "pro") return "ChatGPT Pro";
  if (p === "plus") return "ChatGPT Plus";
  if (p === "team") return "ChatGPT Team";
  if (p === "enterprise") return "ChatGPT Enterprise";
  if (p === "free") return "ChatGPT Free";
  return p ? `ChatGPT ${p.charAt(0).toUpperCase()}${p.slice(1)}` : "ChatGPT";
}

export function parseCodexWhamUsage(
  raw: CodexWhamUsageResponse,
  updatedAt?: string,
  meta?: { id?: string; account?: string },
): HarnessLimitCard {
  const windows: QuotaWindow[] = [];

  const pushWhamWindow = (
    id: string,
    win: { used_percent?: number; limit_window_seconds?: number; reset_at?: number } | null | undefined,
    overrideLabel?: { label: string; sublabel: string },
  ) => {
    if (!win || typeof win.used_percent !== "number") return;
    const usedPercent = clampPercent(win.used_percent);
    const remainingPercent = clampPercent(100 - usedPercent);
    const desc = overrideLabel ?? describeWindowSeconds(win.limit_window_seconds);
    windows.push({
      id,
      label: desc.label,
      sublabel: desc.sublabel,
      usedPercent,
      remainingPercent,
      resetsAt: typeof win.reset_at === "number" ? new Date(win.reset_at * 1000).toISOString() : null,
      windowSeconds: win.limit_window_seconds,
      status: getWindowStatus(remainingPercent),
    });
  };

  pushWhamWindow("primary", raw.rate_limit?.primary_window);
  pushWhamWindow("secondary", raw.rate_limit?.secondary_window);
  if (raw.code_review_rate_limit?.primary_window) {
    pushWhamWindow("code_review", raw.code_review_rate_limit.primary_window, {
      label: "Code review",
      sublabel: "7-day review quota",
    });
  }

  const credits: NonNullable<HarnessLimitCard["credits"]> = [];
  const bal = Number(raw.credits?.balance ?? 0);
  if (raw.credits?.unlimited) {
    credits.push({ label: "Codex credits", remainingText: "Unlimited" });
  } else if (raw.credits?.has_credits || bal > 0) {
    credits.push({ label: "Codex credits", remainingText: formatUsd(bal) });
  }

  return {
    id: meta?.id || "codex",
    harness: "codex",
    name: "Codex",
    vendor: "OpenAI",
    account: meta?.account,
    planName: formatCodexPlan(raw.plan_type),
    source: "live",
    sourceLabel: "OpenAI Backend",
    updatedAt: updatedAt ?? new Date().toISOString(),
    windows,
    credits: credits.length > 0 ? credits : undefined,
  };
}

export function parseCodexRolloutRateLimits(
  raw: CodexRolloutRateLimits,
  nowMs = Date.now(),
  updatedAt?: string,
  meta?: { id?: string; account?: string },
): HarnessLimitCard {
  const windows: QuotaWindow[] = [];

  const pushRolloutWindow = (
    id: string,
    win: { used_percent?: number; window_minutes?: number; resets_at?: number } | null | undefined,
  ) => {
    if (!win || typeof win.used_percent !== "number") return;
    const windowSeconds = typeof win.window_minutes === "number" ? win.window_minutes * 60 : undefined;
    const desc = describeWindowSeconds(windowSeconds);
    const resetMs = typeof win.resets_at === "number" ? win.resets_at * 1000 : null;
    const expired = resetMs !== null && resetMs <= nowMs;
    const usedPercent = expired ? 0 : clampPercent(win.used_percent);
    const remainingPercent = clampPercent(100 - usedPercent);
    windows.push({
      id,
      label: desc.label,
      sublabel: expired ? `${desc.sublabel} (reset)` : desc.sublabel,
      usedPercent,
      remainingPercent,
      resetsAt: !expired && resetMs !== null ? new Date(resetMs).toISOString() : null,
      windowSeconds,
      status: getWindowStatus(remainingPercent),
    });
  };

  pushRolloutWindow("primary", raw.primary);
  pushRolloutWindow("secondary", raw.secondary);

  return {
    id: meta?.id || "codex",
    harness: "codex",
    name: "Codex",
    vendor: "OpenAI",
    account: meta?.account,
    planName: formatCodexPlan(raw.plan_type),
    source: "local",
    sourceLabel: "Session log",
    updatedAt: updatedAt ?? new Date(nowMs).toISOString(),
    windows,
  };
}

const CODEX_ROLLOUT_TAIL_BYTES = 256 * 1024;
const CODEX_ROLLOUT_CANDIDATES = 24;
const CODEX_ROLLOUT_READ_COUNT = 8;

export function latestCodexRateLimitsFromText(
  text: string,
): { rateLimits: CodexRolloutRateLimits; timestamp?: string } | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"rate_limits"')) continue;
    try {
      const parsed = JSON.parse(line);
      const rl = parsed?.payload?.rate_limits;
      if (rl && (rl.primary || rl.secondary)) {
        return { rateLimits: rl as CodexRolloutRateLimits, timestamp: parsed.timestamp };
      }
    } catch {
      // first line of a tail read can be cut mid-record
    }
  }
  return null;
}

async function findLatestCodexRolloutRateLimits(
  rootDir = join(homedir(), ".codex"),
): Promise<{ rateLimits: CodexRolloutRateLimits; updatedAt: string } | null> {
  const sessionsRoot = join(rootDir, "sessions");
  // Rollouts live in YYYY/MM/DD dirs, so name-descending order finds the newest ones without statting the archive.
  const files = await collectJsonlFiles(sessionsRoot, { newestNameFirst: true, limit: CODEX_ROLLOUT_CANDIDATES });
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of files.slice(0, CODEX_ROLLOUT_READ_COUNT)) {
    try {
      const found = latestCodexRateLimitsFromText(await readFileTail(file.path, CODEX_ROLLOUT_TAIL_BYTES));
      if (found) {
        return { rateLimits: found.rateLimits, updatedAt: found.timestamp || new Date(file.mtimeMs).toISOString() };
      }
    } catch {
      // continue
    }
  }
  return null;
}

interface CodexAuthEntry {
  accessToken: string;
  accountId?: string;
  email?: string;
  dir: string;
}

function readCodexAuthEntries(): CodexAuthEntry[] {
  const home = homedir();
  const dirs = new Set<string>();
  if (process.env.CODEX_HOME) dirs.add(process.env.CODEX_HOME);
  dirs.add(join(home, ".codex"));
  try {
    for (const name of readdirSync(home)) {
      if (name.startsWith(".codex")) dirs.add(join(home, name));
    }
  } catch {
    // ignore
  }

  const byKey = new Map<string, CodexAuthEntry>();
  for (const dir of dirs) {
    const authPath = join(dir, "auth.json");
    if (!existsSync(authPath)) continue;
    try {
      const auth = JSON.parse(readFileSync(authPath, "utf8"));
      const accessToken = auth?.tokens?.access_token;
      if (typeof accessToken !== "string" || !accessToken) continue;
      const accountId = typeof auth?.tokens?.account_id === "string" ? auth.tokens.account_id : undefined;
      const jwt = decodeJwtPayload(auth?.tokens?.id_token);
      const email = typeof jwt?.email === "string" ? jwt.email : undefined;
      const key = (accountId || email || accessToken).toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, { accessToken, accountId, email, dir });
      }
    } catch {
      // ignore
    }
  }
  return [...byKey.values()];
}

async function fetchCodexLimits(): Promise<HarnessLimitCard[]> {
  const entries = readCodexAuthEntries();
  const cards: HarnessLimitCard[] = [];
  const multiple = entries.length > 1;

  for (const entry of entries) {
    const cardId = multiple && entry.email ? `codex:${entry.email.toLowerCase()}` : "codex";
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${entry.accessToken}`,
        Accept: "application/json",
        "User-Agent": "codex-cli/0.1.0",
      };
      if (entry.accountId) headers["ChatGPT-Account-Id"] = String(entry.accountId);

      const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
        headers,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = (await res.json()) as CodexWhamUsageResponse;
        if (data.rate_limit) {
          cards.push(parseCodexWhamUsage(data, undefined, { id: cardId, account: entry.email }));
          continue;
        }
      }
    } catch {
      // Fall back to local rollout logs for this dir below
    }

    const local = await findLatestCodexRolloutRateLimits(entry.dir);
    if (local) {
      cards.push(parseCodexRolloutRateLimits(local.rateLimits, Date.now(), local.updatedAt, { id: cardId, account: entry.email }));
    }
  }

  if (cards.length > 0) return cards;

  const local = await findLatestCodexRolloutRateLimits();
  if (!local) return [];
  return [parseCodexRolloutRateLimits(local.rateLimits, Date.now(), local.updatedAt)];
}

// ============================================================================
// 3. Google Antigravity (Cloud Code Live Models API + state.vscdb Protobuf)
// ============================================================================

export interface AntigravityModelQuota {
  id: string;
  label: string;
  remainingFraction: number;
  resetTime: string | null;
}

export interface AntigravityParsedState {
  accountName?: string;
  email?: string;
  tierName?: string;
  availableCredits?: number;
  models: AntigravityModelQuota[];
}

function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  let i = pos;
  while (i < buf.length) {
    const b = buf[i]!;
    result |= BigInt(b & 0x7f) << shift;
    i++;
    if ((b & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, i];
}

interface ProtoField {
  fn: number;
  wt: number;
  val: bigint | Uint8Array | number;
}

function decodeProtoFields(buf: Uint8Array): ProtoField[] {
  const out: ProtoField[] = [];
  let i = 0;
  while (i < buf.length) {
    const [tag, nextI] = readVarint(buf, i);
    i = nextI;
    const wt = Number(tag & 7n);
    const fn = Number(tag >> 3n);
    if (fn <= 0) break;
    if (wt === 0) {
      const [val, n2] = readVarint(buf, i);
      i = n2;
      out.push({ fn, wt, val });
    } else if (wt === 1) {
      if (i + 8 > buf.length) break;
      const dv = new DataView(buf.buffer, buf.byteOffset + i, 8);
      out.push({ fn, wt, val: dv.getFloat64(0, true) });
      i += 8;
    } else if (wt === 2) {
      const [len, n2] = readVarint(buf, i);
      const l = Number(len);
      i = n2;
      if (l < 0 || i + l > buf.length) break;
      out.push({ fn, wt, val: buf.subarray(i, i + l) });
      i += l;
    } else if (wt === 5) {
      if (i + 4 > buf.length) break;
      const dv = new DataView(buf.buffer, buf.byteOffset + i, 4);
      out.push({ fn, wt, val: dv.getFloat32(0, true) });
      i += 4;
    } else {
      break;
    }
  }
  return out;
}

export function parseAntigravityUserStatusProto(base64Buf: string): AntigravityParsedState {
  const result: AntigravityParsedState = { models: [] };
  try {
    const outerBytes = Buffer.from(base64Buf, "base64");
    const outerFields = decodeProtoFields(outerBytes);

    // If this comes from antigravityUnifiedStateSync.userStatus, the UserStatus proto is nested in field 1 -> field 2 -> field 1 (base64)
    let userStatusBytes: Uint8Array = outerBytes;
    const f1 = outerFields.find((f) => f.fn === 1 && f.wt === 2);
    if (f1 && f1.val instanceof Uint8Array) {
      const inner1 = decodeProtoFields(f1.val);
      const f2 = inner1.find((f) => f.fn === 2 && f.wt === 2);
      if (f2 && f2.val instanceof Uint8Array) {
        const inner2 = decodeProtoFields(f2.val);
        const b64Field = inner2.find((f) => f.fn === 1 && f.wt === 2);
        if (b64Field && b64Field.val instanceof Uint8Array) {
          const innerB64 = Buffer.from(b64Field.val).toString("utf8");
          userStatusBytes = Buffer.from(innerB64, "base64");
        }
      }
    }

    const top = decodeProtoFields(userStatusBytes);
    for (const f of top) {
      if (f.fn === 3 && f.wt === 2 && f.val instanceof Uint8Array) {
        const name = Buffer.from(f.val).toString("utf8").trim();
        if (name) result.accountName = name;
      }
      if (f.fn === 7 && f.wt === 2 && f.val instanceof Uint8Array) {
        const email = Buffer.from(f.val).toString("utf8").trim();
        if (email && email.includes("@")) result.email = email;
      }
      if (f.fn === 33 && f.wt === 2 && f.val instanceof Uint8Array) {
        for (const mf of decodeProtoFields(f.val)) {
          if (mf.fn === 1 && mf.wt === 2 && mf.val instanceof Uint8Array) {
            const cfg = decodeProtoFields(mf.val);
            const labelField = cfg.find((c) => c.fn === 1 && c.wt === 2);
            const modelIdField = cfg.find((c) => c.fn === 2 && c.wt === 2);
            const quotaField = cfg.find((c) => c.fn === 15 && c.wt === 2);
            if (!labelField || !(labelField.val instanceof Uint8Array)) continue;
            const label = Buffer.from(labelField.val).toString("utf8");
            let id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            if (modelIdField && modelIdField.val instanceof Uint8Array) {
              const mInner = decodeProtoFields(modelIdField.val);
              const mId = mInner.find((c) => c.fn === 1 && c.wt === 0);
              if (mId) id = `model-${String(mId.val)}`;
            }
            let remainingFraction = 1;
            let resetTime: string | null = null;
            if (quotaField && quotaField.val instanceof Uint8Array) {
              const qf = decodeProtoFields(quotaField.val);
              const fracField = qf.find((c) => c.fn === 1 && c.wt === 5);
              const resetField = qf.find((c) => c.fn === 2 && c.wt === 2);
              // In protobuf3, float32 field 1 is omitted when remainingFraction === 0.0
              remainingFraction = typeof fracField?.val === "number" ? fracField.val : 0;
              if (resetField && resetField.val instanceof Uint8Array) {
                const tsFields = decodeProtoFields(resetField.val);
                const secField = tsFields.find((c) => c.fn === 1 && c.wt === 0);
                if (typeof secField?.val === "bigint") {
                  resetTime = new Date(Number(secField.val) * 1000).toISOString();
                }
              }
            }
            result.models.push({ id, label, remainingFraction, resetTime });
          }
        }
      }

      if (f.fn === 36 && f.wt === 2 && f.val instanceof Uint8Array) {
        const tf = decodeProtoFields(f.val);
        const tierNameField = tf.find((c) => c.fn === 2 && c.wt === 2);
        if (tierNameField && tierNameField.val instanceof Uint8Array) {
          result.tierName = Buffer.from(tierNameField.val).toString("utf8");
        }
        const creditsMsg = tf.find((c) => c.fn === 14 && c.wt === 2);
        if (creditsMsg && creditsMsg.val instanceof Uint8Array) {
          const cf = decodeProtoFields(creditsMsg.val);
          const avail = cf.find((c) => c.fn === 2 && c.wt === 0);
          if (typeof avail?.val === "bigint") {
            result.availableCredits = Number(avail.val);
          }
        }
      }
    }
  } catch {
    // ignore malformed buffer
  }
  return result;
}

export function buildAntigravityLimitCard(
  models: AntigravityModelQuota[],
  opts: {
    id?: string;
    account?: string;
    tierName?: string;
    availableCredits?: number;
    source: "live" | "local";
    updatedAt?: string;
    nowMs?: number;
    note?: string;
  },
): HarnessLimitCard {
  const nowMs = opts.nowMs ?? Date.now();

  // Group models by family (Gemini vs Claude/GPT) and quota signature so the UI shows crisp pools
  const pools = new Map<
    string,
    {
      family: "gemini" | "claude-gpt" | "other";
      remainingPercent: number;
      resetsAt: string | null;
      labels: string[];
    }
  >();

  for (const m of models) {
    const lower = m.label.toLowerCase();
    // Skip internal chat/tab completion utility models
    if (lower.includes("chat_") || lower.includes("tab_") || lower.startsWith(" finish")) continue;

    const resetMs = m.resetTime ? Date.parse(m.resetTime) : null;
    const expired = resetMs !== null && Number.isFinite(resetMs) && resetMs <= nowMs;
    const effectiveFraction = expired ? 1 : m.remainingFraction;
    const remainingPercent = clampPercent(effectiveFraction * 100);
    // An untouched pool reports a reset of "now + window", which changes on every poll and is not a real reset.
    const untouched = !expired && effectiveFraction >= 0.999;
    const effectiveReset = !expired && !untouched && m.resetTime ? m.resetTime : null;

    const family: "gemini" | "claude-gpt" | "other" = lower.includes("gemini")
      ? "gemini"
      : lower.includes("claude") || lower.includes("gpt")
      ? "claude-gpt"
      : "other";

    const key = `${family}:${Math.round(remainingPercent)}:${effectiveReset ?? "none"}`;
    const existing = pools.get(key);
    if (existing) {
      if (!existing.labels.includes(m.label)) existing.labels.push(m.label);
    } else {
      pools.set(key, {
        family,
        remainingPercent,
        resetsAt: effectiveReset,
        labels: [m.label],
      });
    }
  }

  const windows: QuotaWindow[] = [];
  let idx = 0;
  for (const pool of pools.values()) {
    idx++;
    const usedPercent = clampPercent(100 - pool.remainingPercent);
    const familyLabel =
      pool.family === "gemini"
        ? "Gemini pool"
        : pool.family === "claude-gpt"
        ? "Claude & GPT pool"
        : pool.labels[0] || "Model pool";
    const cleanLabels = [
      ...new Set(
        pool.labels.map((l) =>
          l
            .replace(/\s*\((Thinking|Medium|High|Low)\)/gi, "")
            .trim(),
        ),
      ),
    ];
    windows.push({
      id: `pool_${idx}`,
      label: pools.size > 2 && cleanLabels.length === 1 ? cleanLabels[0]! : familyLabel,
      sublabel: cleanLabels.slice(0, 4).join(" · "),
      detail: cleanLabels.join(", "),
      usedPercent,
      remainingPercent: pool.remainingPercent,
      resetsAt: pool.resetsAt,
      windowSeconds: 5 * 3600,
      status: getWindowStatus(pool.remainingPercent),
    });
  }

  const credits: NonNullable<HarnessLimitCard["credits"]> = [];
  if (typeof opts.availableCredits === "number" && opts.availableCredits > 0) {
    credits.push({
      label: "AI credits",
      remainingText: `${opts.availableCredits.toLocaleString()} left`,
    });
  }

  return {
    id: opts.id || "antigravity",
    harness: "antigravity",
    name: "Antigravity",
    vendor: "Google",
    account: opts.account,
    planName: opts.tierName || "Google AI",
    source: opts.source,
    sourceLabel: opts.source === "live" ? "Cloud Code API" : "Local IDE state",
    updatedAt: opts.updatedAt ?? new Date(nowMs).toISOString(),
    windows,
    credits: credits.length > 0 ? credits : undefined,
    note: opts.note,
  };
}

export interface AntigravityInstall {
  /** App folder name, e.g. "Antigravity" or "Antigravity IDE". */
  app: string;
  dbPath: string;
  mtimeMs: number;
}

// Several Antigravity apps can be installed side by side, each signed into its own Google account,
// and an app that is no longer used keeps its old state forever. The most recently written one is the
// account in use.
export function pickActiveAntigravityInstall(installs: AntigravityInstall[]): AntigravityInstall | null {
  return [...installs].sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
}

function listAntigravityInstalls(): AntigravityInstall[] {
  const home = homedir();
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || join(home, "AppData", "Roaming")
      : process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : process.env.XDG_CONFIG_HOME || join(home, ".config");

  const installs: AntigravityInstall[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(base).filter((n) => n.toLowerCase().startsWith("antigravity"));
  } catch {
    return installs;
  }
  for (const app of names) {
    const dbPath = join(base, app, "User", "globalStorage", "state.vscdb");
    try {
      installs.push({ app, dbPath, mtimeMs: statSync(dbPath).mtimeMs });
    } catch {
      // not an editor install
    }
    const profilesDir = join(base, app, "User", "profiles");
    try {
      for (const prof of readdirSync(profilesDir)) {
        const profDb = join(profilesDir, prof, "globalStorage", "state.vscdb");
        try {
          installs.push({ app: `${app} (${prof})`, dbPath: profDb, mtimeMs: statSync(profDb).mtimeMs });
        } catch {
          // ignore
        }
      }
    } catch {
      // no profiles dir
    }
  }
  return installs.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

const normalizeModelName = (label: string) => label.replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();

// The saved login token can belong to a different Google account than the active app. Accounts on different
// plans or rollouts expose different Gemini models, so a live answer that shares none of the active
// app's Gemini models is treated as someone else's quota.
export function liveMatchesLocal(local: AntigravityModelQuota[], live: AntigravityModelQuota[]): boolean {
  const gemini = (models: AntigravityModelQuota[]) =>
    new Set(models.map((m) => normalizeModelName(m.label)).filter((n) => n.includes("gemini")));
  const localGemini = gemini(local);
  if (localGemini.size === 0) return true;
  const liveGemini = gemini(live);
  return [...localGemini].some((n) => liveGemini.has(n));
}

// PowerShell + Add-Type costs seconds and a process spawn, so each target runs at most once per TTL.
const readWindowsCredentials = memoizeAsyncTtl(readWindowsCredentialsUncached, CREDENTIAL_TTL_MS);
const readKeychainSecret = memoizeAsyncTtl(readKeychainSecretUncached, CREDENTIAL_TTL_MS);
const decryptWindowsDpapi = memoizeAsyncTtl(decryptWindowsDpapiUncached, CREDENTIAL_TTL_MS);

async function readWindowsCredential(targetNameOrPrefix: string): Promise<string | null> {
  const list = await readWindowsCredentials(targetNameOrPrefix);
  return list[0] ?? null;
}

async function decryptWindowsDpapiUncached(encBase64: string): Promise<Buffer | null> {
  if (process.platform !== "win32") return null;
  try {
    const safeB64 = encBase64.replace(/'/g, "");
    const psScript = `
Add-Type -AssemblyName System.Security
$enc = [Convert]::FromBase64String('${safeB64}')
$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($dec)
`;
    const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", psScript], {
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => proc.kill(), 6_000);
    try {
      const text = (await new Response(proc.stdout).text()).trim();
      return text ? Buffer.from(text, "base64") : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function readKeychainSecretUncached(service: string): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const proc = Bun.spawn(["security", "find-generic-password", "-s", service, "-w"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), 5_000);
    try {
      const text = (await new Response(proc.stdout).text()).trim();
      return text || null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function readWindowsCredentialsUncached(targetNameOrPrefix: string): Promise<string[]> {
  if (process.platform !== "win32") return [];
  try {
    const safeTarget = targetNameOrPrefix.replace(/'/g, "''");
    const psScript = `
$code = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class CredHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredEnumerate(string filter, int flag, out int count, out IntPtr pCredentials);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern void CredFree(IntPtr cred);
    public static string[] GetAllBase64(string target) {
        var list = new List<string>();
        int count;
        IntPtr ptr;
        if (CredEnumerate(target + "*", 0, out count, out ptr) && count > 0) {
            for (int i = 0; i < count; i++) {
                IntPtr cPtr = Marshal.ReadIntPtr(ptr, i * IntPtr.Size);
                CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(cPtr, typeof(CREDENTIAL));
                if (cred.CredentialBlobSize > 0 && cred.CredentialBlob != IntPtr.Zero) {
                    byte[] b = new byte[cred.CredentialBlobSize];
                    Marshal.Copy(cred.CredentialBlob, b, 0, cred.CredentialBlobSize);
                    list.Add(Convert.ToBase64String(b));
                }
            }
            CredFree(ptr);
            return list.ToArray();
        }
        if (CredRead(target, 1, 0, out ptr)) {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            if (cred.CredentialBlobSize > 0 && cred.CredentialBlob != IntPtr.Zero) {
                byte[] b = new byte[cred.CredentialBlobSize];
                Marshal.Copy(cred.CredentialBlob, b, 0, cred.CredentialBlobSize);
                list.Add(Convert.ToBase64String(b));
            }
            CredFree(ptr);
        }
        return list.ToArray();
    }
}
'@
Add-Type -TypeDefinition $code
[CredHelper]::GetAllBase64('${safeTarget}') -join "\`n"
`;
    const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", psScript], {
      stdout: "pipe",
      stderr: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => proc.kill(), 6_000);
    try {
      const text = (await new Response(proc.stdout).text()).trim();
      if (!text) return [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const line of text.split(/\r?\n/)) {
        const b64 = line.trim();
        if (!b64) continue;
        const decoded = Buffer.from(b64, "base64").toString("utf8").trim();
        if (decoded && !seen.has(decoded)) {
          seen.add(decoded);
          out.push(decoded);
        }
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

interface AntigravityAccountState {
  key: string;
  email?: string;
  accountName?: string;
  tierName?: string;
  availableCredits?: number;
  models: AntigravityModelQuota[];
  source: "live" | "local";
  updatedAt: string;
}

async function fetchAntigravityLimits(): Promise<HarnessLimitCard[]> {
  const installs = listAntigravityInstalls();
  const accountsByKey = new Map<string, AntigravityAccountState>();

  for (const inst of installs) {
    try {
      const db = new Database(inst.dbPath, { readonly: true });
      const syncedAt = new Date(inst.mtimeMs).toISOString();

      // 1. Primary unified state sync userStatus
      const row = db
        .query("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.userStatus'")
        .get() as { value?: string } | null;
      if (row?.value) {
        const parsed = parseAntigravityUserStatusProto(row.value);
        if (parsed.models.length > 0) {
          const key = (parsed.email || parsed.accountName || inst.app).toLowerCase();
          if (!accountsByKey.has(key)) {
            accountsByKey.set(key, {
              key,
              email: parsed.email,
              accountName: parsed.accountName,
              tierName: parsed.tierName,
              availableCredits: parsed.availableCredits,
              models: parsed.models,
              source: "local",
              updatedAt: syncedAt,
            });
          }
        }
      }

      // 2. Fallback or additional account in antigravityAuthStatus
      const authRow = db
        .query("SELECT value FROM ItemTable WHERE key = 'antigravityAuthStatus'")
        .get() as { value?: string } | null;
      if (authRow?.value) {
        try {
          const parsedJson = JSON.parse(authRow.value);
          if (parsedJson?.userStatusProtoBinaryBase64) {
            const parsed = parseAntigravityUserStatusProto(parsedJson.userStatusProtoBinaryBase64);
            const email = typeof parsedJson.email === "string" && parsedJson.email.includes("@") ? parsedJson.email : parsed.email;
            const accountName = typeof parsedJson.name === "string" ? parsedJson.name : parsed.accountName;
            // Only use authStatus when unified state sync had no models for this install
            if (parsed.models.length > 0 && !row?.value) {
              const key = (email || accountName || inst.app).toLowerCase();
              if (!accountsByKey.has(key)) {
                accountsByKey.set(key, {
                  key,
                  email,
                  accountName,
                  tierName: parsed.tierName,
                  availableCredits: parsed.availableCredits,
                  models: parsed.models,
                  source: "local",
                  updatedAt: syncedAt,
                });
              }
            }
          }
        } catch {
          // ignore
        }
      }
      db.close();
    } catch {
      // ignore sqlite errors
    }
  }

  // Try live Cloud Code fetch using all gemini:antigravity* credentials in Windows Credential Manager
  const rawWinCreds = await readWindowsCredentials("gemini:antigravity");
  for (const rawWinCred of rawWinCreds) {
    try {
      const clean = rawWinCred.replace(/^[^\{]*/, "");
      const parsed = JSON.parse(clean);
      const expiry = parsed?.token?.expiry ? Date.parse(parsed.token.expiry) : null;
      const accessToken = parsed?.token?.access_token;
      if (!accessToken || (expiry && expiry <= Date.now())) continue;

      const jwt = decodeJwtPayload(parsed?.id_token);
      const liveEmail = typeof jwt?.email === "string" ? jwt.email : undefined;

      const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "antigravity/1.3.4",
        },
        body: "{}",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) continue;

      const data = (await res.json()) as {
        models?: Record<
          string,
          {
            displayName?: string;
            quotaInfo?: { remainingFraction?: number; resetTime?: string };
          }
        >;
      };
      if (!data?.models) continue;

      const liveModels: AntigravityModelQuota[] = [];
      for (const [id, m] of Object.entries(data.models)) {
        if (!m.quotaInfo) continue;
        if (id.includes("chat_") || id.includes("tab_")) continue;
        const label = m.displayName || (id.startsWith("gemini-") ? id.replace(/-tiered$/, "").replace(/-/g, " ") : undefined);
        if (!label) continue;
        liveModels.push({
          id,
          label,
          remainingFraction: typeof m.quotaInfo.remainingFraction === "number" ? m.quotaInfo.remainingFraction : 0,
          resetTime: m.quotaInfo.resetTime ?? null,
        });
      }
      if (liveModels.length === 0) continue;

      const emailKey = liveEmail?.toLowerCase();
      const matched =
        (emailKey ? accountsByKey.get(emailKey) : undefined) ??
        [...accountsByKey.values()].find((a) => !a.email && liveMatchesLocal(a.models, liveModels));

      if (matched) {
        matched.models = liveModels;
        matched.source = "live";
        matched.updatedAt = new Date().toISOString();
        if (liveEmail && !matched.email) matched.email = liveEmail;
      } else {
        const key = emailKey || `live-${accountsByKey.size + 1}`;
        accountsByKey.set(key, {
          key,
          email: liveEmail,
          models: liveModels,
          source: "live",
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {
      // ignore failed credential
    }
  }

  const all = [...accountsByKey.values()];
  const multiple = all.length > 1;
  return all.map((acc) =>
    buildAntigravityLimitCard(acc.models, {
      id: multiple ? `antigravity:${acc.key}` : "antigravity",
      account: acc.email || acc.accountName,
      tierName: acc.tierName,
      availableCredits: acc.availableCredits,
      source: acc.source,
      updatedAt: acc.updatedAt,
    }),
  );
}

// ============================================================================
// 4. OpenCode Go (Local 5h / 7d / 30d Rolling Dollar Windows)
// ============================================================================

export interface OpenCodeGoSpendEvent {
  timestampMs: number;
  model: string;
  costUsd: number;
}

export function estimateOpenCodeGoCost(
  modelId: string,
  tokens: { input?: number; output?: number; cacheWrite?: number; cacheRead?: number },
): number {
  const clean = modelId.toLowerCase().replace(/^opencode-go\//, "").replace(/^oc-sdk-go\//, "");
  const rates = OPENCODE_GO_RATES[clean];
  if (!rates) return 0;
  const [inRate, outRate, cwRate, crRate] = rates;
  return (
    ((tokens.input ?? 0) * inRate +
      (tokens.output ?? 0) * outRate +
      (tokens.cacheWrite ?? 0) * cwRate +
      (tokens.cacheRead ?? 0) * crRate) /
    1_000_000
  );
}

export function buildOpenCodeGoLimitCard(events: OpenCodeGoSpendEvent[], nowMs = Date.now()): HarnessLimitCard {
  const specs = OPENCODE_GO_LIST_VALUES.caps.map((cap) => ({
    ...cap,
    sublabel: `$${cap.limitUsd} rolling cap`,
  }));

  const windows: QuotaWindow[] = specs.map((spec) => {
    const cutoff = nowMs - spec.seconds * 1000;
    const inWindow = events.filter((e) => e.timestampMs >= cutoff && e.timestampMs <= nowMs + 60_000 && e.costUsd > 0);
    const usedUsd = inWindow.reduce((sum, e) => sum + e.costUsd, 0);
    const remainingUsd = Math.max(0, spec.limitUsd - usedUsd);
    const usedPercent = clampPercent((usedUsd / spec.limitUsd) * 100);
    const remainingPercent = clampPercent(100 - usedPercent);

    // Oldest event in the rolling window determines when usage begins rolling off
    let resetsAt: string | null = null;
    if (inWindow.length > 0) {
      const oldestMs = Math.min(...inWindow.map((e) => e.timestampMs));
      resetsAt = new Date(oldestMs + spec.seconds * 1000).toISOString();
    }

    return {
      id: spec.id,
      label: spec.label,
      sublabel: spec.sublabel,
      usedPercent,
      remainingPercent,
      usedValueText: formatUsd(usedUsd),
      limitValueText: formatUsd(spec.limitUsd),
      remainingValueText: `${formatUsd(remainingUsd)} left`,
      resetsAt,
      windowSeconds: spec.seconds,
      status: getWindowStatus(remainingPercent),
    };
  });

  // Breakdown of 30d spend by model
  const cutoff30d = nowMs - 30 * 86400 * 1000;
  const byModel = new Map<string, number>();
  let total30d = 0;
  for (const e of events) {
    if (e.timestampMs >= cutoff30d && e.costUsd > 0) {
      byModel.set(e.model, (byModel.get(e.model) ?? 0) + e.costUsd);
      total30d += e.costUsd;
    }
  }
  const breakdownItems = [...byModel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, cost]) => ({
      name,
      percent: total30d > 0 ? clampPercent((cost / total30d) * 100) : 0,
    }));

  return {
    id: "opencode",
    harness: "opencode",
    name: "OpenCode Go",
    vendor: "Anomaly",
    planName: OPENCODE_GO_LIST_VALUES.planName,
    source: "local",
    sourceLabel: "Local rolling ledger",
    updatedAt: new Date(nowMs).toISOString(),
    note: "Estimated from local logs against list caps",
    windows,
    breakdown:
      breakdownItems.length > 0
        ? {
            label: "30-day usage by model",
            items: breakdownItems,
          }
        : undefined,
  };
}

// Pi sessions can be hundreds of MB, so each file is streamed line by line; only the file count is bounded.
// Skipping big files here would silently drop their spend from the rolling caps.
const PI_SESSION_MAX_FILES = 300;
const PI_SESSION_BATCH = 4;

async function readPiOpenCodeGoEvents(path: string, cutoffMs: number): Promise<OpenCodeGoSpendEvent[]> {
  const events: OpenCodeGoSpendEvent[] = [];
  try {
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.includes("opencode-go") || line.includes("oc-sdk-go")) events.push(...extractPiOpenCodeGoEvents(line, cutoffMs));
    }
  } catch {
    // unreadable file: skip it
  }
  return events;
}

export function extractPiOpenCodeGoEvents(text: string, cutoffMs: number): OpenCodeGoSpendEvent[] {
  const events: OpenCodeGoSpendEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes("opencode-go") && !line.includes("oc-sdk-go")) continue;
    try {
      const obj = JSON.parse(line);
      const msg = obj?.message;
      if (!msg || (msg.provider !== "opencode-go" && msg.provider !== "oc-sdk-go")) continue;
      const ts = typeof msg.timestamp === "number" ? msg.timestamp : Date.parse(obj.timestamp);
      if (!Number.isFinite(ts) || ts < cutoffMs) continue;
      const modelId = String(msg.model || "unknown");
      const recordedCost = typeof msg.usage?.cost?.total === "number" ? msg.usage.cost.total : 0;
      const costUsd =
        recordedCost > 0
          ? recordedCost
          : estimateOpenCodeGoCost(modelId, {
              input: msg.usage?.input,
              output: msg.usage?.output,
              cacheWrite: msg.usage?.cacheWrite,
              cacheRead: msg.usage?.cacheRead,
            });
      if (costUsd > 0) events.push({ timestampMs: ts, model: modelId, costUsd });
    } catch {
      // ignore
    }
  }
  return events;
}

async function collectOpenCodeGoEvents(nowMs = Date.now()): Promise<OpenCodeGoSpendEvent[] | null> {
  const home = homedir();
  const ocAuthPath = join(home, ".local", "share", "opencode", "auth.json");
  const piAuthPath = join(home, ".pi", "agent", "auth.json");
  const ocDbPath = join(home, ".local", "share", "opencode", "opencode.db");

  let hasOpenCodeGoAuth = false;
  for (const p of [ocAuthPath, piAuthPath]) {
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf8"));
        if (j?.["opencode-go"]) hasOpenCodeGoAuth = true;
      } catch {
        // ignore
      }
    }
  }

  const cutoff30d = nowMs - 30 * 86400 * 1000;
  const events: OpenCodeGoSpendEvent[] = [];

  // 1. Check OpenCode SQLite DB
  if (existsSync(ocDbPath)) {
    try {
      const db = new Database(ocDbPath, { readonly: true });
      // Filter by provider in SQL so we don't parse every message row of the last 30 days;
      // fall back to the unfiltered scan if this SQLite build lacks json_extract.
      let rows: { time_created: number; data: string }[];
      try {
        rows = db
          .query(
            "SELECT time_created, data FROM message WHERE time_created >= ? AND json_extract(data, '$.providerID') IN ('opencode-go', 'opencode')",
          )
          .all(cutoff30d) as { time_created: number; data: string }[];
      } catch {
        rows = db
          .query("SELECT time_created, data FROM message WHERE time_created >= ?")
          .all(cutoff30d) as { time_created: number; data: string }[];
      }
      for (const r of rows) {
        try {
          const d = JSON.parse(r.data);
          const provider = String(d?.providerID || "");
          const modelId = String(d?.modelID || "");
          if (provider !== "opencode-go" && !(provider === "opencode" && OPENCODE_GO_RATES[modelId])) continue;
          const recordedCost = typeof d?.cost === "number" ? d.cost : 0;
          const costUsd =
            recordedCost > 0
              ? recordedCost
              : estimateOpenCodeGoCost(modelId, {
                  input: d?.tokens?.input,
                  output: d?.tokens?.output,
                  cacheWrite: d?.tokens?.cache?.write,
                  cacheRead: d?.tokens?.cache?.read,
                });
          if (costUsd > 0) {
            events.push({ timestampMs: r.time_created, model: modelId, costUsd });
          }
        } catch {
          // ignore row
        }
      }
      db.close();
    } catch {
      // ignore db error
    }
  }

  // 2. Check ~/.pi/agent/sessions/**/*.jsonl for opencode-go / oc-sdk-go usage
  const piFiles = await collectJsonlFiles(join(home, ".pi", "agent", "sessions"), { minMtimeMs: cutoff30d });
  const recent = piFiles.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, PI_SESSION_MAX_FILES);
  for (let i = 0; i < recent.length; i += PI_SESSION_BATCH) {
    const batch = await Promise.all(recent.slice(i, i + PI_SESSION_BATCH).map((f) => readPiOpenCodeGoEvents(f.path, cutoff30d)));
    for (const found of batch) events.push(...found);
  }

  if (!hasOpenCodeGoAuth && events.length === 0) return null;
  return events;
}

// ============================================================================
// 5. GitHub Copilot (copilot_internal/user)
// ============================================================================

export interface CopilotInternalUserResponse {
  login?: string;
  copilot_plan?: string;
  access_type_sku?: string;
  quota_reset_date_utc?: string;
  quota_snapshots?: Record<
    string,
    {
      entitlement?: number;
      remaining?: number;
      percent_remaining?: number;
      unlimited?: boolean;
      has_quota?: boolean;
    }
  >;
}

export function parseCopilotUsage(
  raw: CopilotInternalUserResponse,
  updatedAt?: string,
  opts?: { id?: string; account?: string },
): HarnessLimitCard | null {
  const snapshots = raw.quota_snapshots;
  if (!snapshots) return null;

  const resetIso = raw.quota_reset_date_utc || null;
  const windows: QuotaWindow[] = [];

  const labels: Record<string, { label: string; sublabel: string }> = {
    premium_interactions: { label: "Premium requests", sublabel: "Monthly premium allowance" },
    chat: { label: "Chat messages", sublabel: "Monthly chat allowance" },
    completions: { label: "Code completions", sublabel: "Monthly completions" },
  };

  for (const [key, meta] of Object.entries(labels)) {
    const snap = snapshots[key];
    if (!snap || snap.unlimited || snap.has_quota === false) continue;
    if (typeof snap.entitlement === "number" && snap.entitlement <= 0) continue;
    if (typeof snap.percent_remaining !== "number") continue;
    const remainingPercent = clampPercent(snap.percent_remaining);
    const usedPercent = clampPercent(100 - remainingPercent);
    const entitlement = typeof snap.entitlement === "number" ? snap.entitlement : undefined;
    const remaining = typeof snap.remaining === "number" ? snap.remaining : undefined;
    const used = entitlement !== undefined && remaining !== undefined ? Math.max(0, entitlement - remaining) : undefined;

    windows.push({
      id: key,
      label: meta.label,
      sublabel: meta.sublabel,
      usedPercent,
      remainingPercent,
      usedValueText: used !== undefined ? used.toLocaleString() : undefined,
      limitValueText: entitlement !== undefined ? entitlement.toLocaleString() : undefined,
      remainingValueText: remaining !== undefined ? `${remaining.toLocaleString()} left` : undefined,
      resetsAt: resetIso,
      status: getWindowStatus(remainingPercent),
    });
  }

  if (windows.length === 0) return null;

  const sku = (raw.access_type_sku || "").toLowerCase();
  const plan = (raw.copilot_plan || "").toLowerCase();
  let planName = "GitHub Copilot";
  if (sku.includes("free")) planName = "Copilot Free";
  else if (plan === "individual_pro" || sku.includes("pro")) planName = "Copilot Pro";
  else if (plan === "business") planName = "Copilot Business";
  else if (plan === "enterprise") planName = "Copilot Enterprise";

  const account = opts?.account || (typeof raw.login === "string" && raw.login ? raw.login : undefined);

  return {
    id: opts?.id || "copilot",
    harness: "copilot",
    name: "Copilot",
    vendor: "GitHub",
    account,
    planName,
    source: "live",
    sourceLabel: "GitHub API",
    updatedAt: updatedAt ?? new Date().toISOString(),
    windows,
  };
}

async function fetchCopilotLimits(): Promise<HarnessLimitCard[]> {
  const home = homedir();
  const configDirs = [
    join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "github-copilot"),
    join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "github-copilot"),
  ];

  const tokens = new Map<string, string | undefined>();
  for (const dir of configDirs) {
    for (const file of ["hosts.json", "apps.json"]) {
      const p = join(dir, file);
      if (!existsSync(p)) continue;
      try {
        const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, { oauth_token?: string; user?: string }>;
        for (const [key, entry] of Object.entries(j ?? {})) {
          if (key.startsWith("github.com") && entry?.oauth_token) {
            tokens.set(entry.oauth_token, typeof entry.user === "string" ? entry.user : undefined);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  const winTokens = await readWindowsCredentials("gh:github.com");
  for (const tok of winTokens) {
    if (tok && !tokens.has(tok)) tokens.set(tok, undefined);
  }

  if (tokens.size === 0) return [];

  const cardsByAccount = new Map<string, HarnessLimitCard>();
  for (const [ghToken, hintUser] of tokens) {
    try {
      const res = await fetch("https://api.github.com/copilot_internal/user", {
        headers: {
          Authorization: `token ${ghToken}`,
          Accept: "application/json",
          "Editor-Version": "vscode/1.96.0",
          "Copilot-Integration-Id": "vscode-chat",
          "User-Agent": "GitHubCopilotChat/0.24.0",
        },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as CopilotInternalUserResponse;
      const card = parseCopilotUsage(data, undefined, { account: data.login || hintUser });
      if (!card) continue;
      const key = (card.account || ghToken).toLowerCase();
      if (!cardsByAccount.has(key)) {
        cardsByAccount.set(key, card);
      }
    } catch {
      // ignore failed token
    }
  }

  const all = [...cardsByAccount.values()];
  if (all.length > 1) {
    return all.map((c, idx) => ({
      ...c,
      id: `copilot:${(c.account || String(idx + 1)).toLowerCase()}`,
    }));
  }
  return all;
}

// ============================================================================
// Coordinator & Cache
// ============================================================================

let memoryCache: { payload: LimitsPayload; fetchedAtMs: number } | null = null;
let inFlightPromise: Promise<LimitsPayload> | null = null;

async function readDiskCache(): Promise<LimitsPayload | null> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8")) as LimitsPayload;
  } catch {
    return null;
  }
}

async function writeDiskCache(payload: LimitsPayload): Promise<void> {
  try {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(payload, null, 2));
  } catch {
    // ignore cache write failure
  }
}

// When Anthropic's quota can not be read (expired sign-in, rate limit), fall back to the current
// 5-hour session rebuilt from local logs: a reset time and activity, but no percentage.
async function fetchClaudeWithLocalFallback(): Promise<HarnessLimitCard[]> {
  const creds = await readAllClaudeOAuthCredentials();
  const multiple = creds.length > 1;
  const liveCards: HarnessLimitCard[] = [];
  let firstErrorCard: HarnessLimitCard | null = null;

  for (let i = 0; i < creds.length; i++) {
    const cred = creds[i]!;
    const cardId = multiple ? `claude:${(cred.account || cred.accountUuid || String(i + 1)).toLowerCase()}` : "claude";
    const card = await fetchClaudeLimitsForCredential(cred, cardId);
    if (card && card.windows.length > 0) {
      liveCards.push(card);
    } else if (card && !firstErrorCard) {
      firstErrorCard = card;
    }
  }

  if (liveCards.length > 0) return liveCards;

  const block = await findCurrentClaudeBlock();
  const primaryOauth = creds[0] ?? null;
  if (!block) return firstErrorCard ? [firstErrorCard] : [];

  const reason = firstErrorCard?.error ?? failureReasons.get("claude") ?? "Live quota unavailable";
  return [
    {
      id: "claude",
      harness: "claude",
      name: "Claude Code",
      vendor: "Anthropic",
      account: primaryOauth?.account,
      planName: firstErrorCard?.planName ?? formatClaudePlanName(primaryOauth?.subscriptionType, primaryOauth?.rateLimitTier),
      source: "local",
      sourceLabel: "Local logs",
      updatedAt: new Date().toISOString(),
      windows: [],
      block,
      note: `${reason}. Session estimated from local logs.`,
    },
  ];
}

type ProviderResult = HarnessLimitCard | HarnessLimitCard[] | null;

const PROVIDERS: { id: string; run: () => Promise<ProviderResult> }[] = [
  { id: "claude", run: fetchClaudeWithLocalFallback },
  { id: "antigravity", run: fetchAntigravityLimits },
  { id: "codex", run: fetchCodexLimits },
  {
    id: "opencode",
    run: async () => {
      const events = await collectOpenCodeGoEvents();
      return events ? buildOpenCodeGoLimitCard(events) : null;
    },
  },
  { id: "copilot", run: fetchCopilotLimits },
];

// A card is worth showing when it has quota windows, or an error the UI should surface (e.g. expired sign-in).
function isShowable(card: HarnessLimitCard | null | undefined): card is HarnessLimitCard {
  return !!card && (card.windows.length > 0 || !!card.error || !!card.block);
}

// Combines this round's results with the previous payload. A provider that failed (null/empty)
// keeps its last good card marked stale, until that snapshot is older than STALE_MAX_AGE_MS.
export function mergeWithCache(
  prevById: ReadonlyMap<string, HarnessLimitCard>,
  fresh: ReadonlyMap<string, ProviderResult>,
  nowMs: number = Date.now(),
  reasons: ReadonlyMap<string, string> = new Map(),
): HarnessLimitCard[] {
  const items: HarnessLimitCard[] = [];
  for (const [id, entry] of fresh) {
    const candidates = Array.isArray(entry) ? entry : entry ? [entry] : [];
    const showable = candidates.filter(isShowable);
    if (showable.length > 0) {
      for (const card of showable) {
        const { stale: _stale, staleSince: _staleSince, ...clean } = card;
        items.push(clean);
      }
      continue;
    }

    const cachedCards = [...prevById.values()].filter(
      (c) => (c.id === id || c.id.startsWith(`${id}:`)) && c.windows.length > 0,
    );
    const reason = reasons.get(id);
    if (cachedCards.length > 0) {
      for (const cached of cachedCards) {
        // staleSince stays the time of the last successful fetch across repeated failures.
        const staleSince = cached.stale && cached.staleSince ? cached.staleSince : cached.updatedAt;
        const age = nowMs - Date.parse(staleSince);
        if (Number.isFinite(age) && age <= STALE_MAX_AGE_MS) {
          items.push({ ...cached, stale: true, staleSince });
          continue;
        }
        // Too old to trust: keep the tool visible but without numbers that would read as current.
        items.push({
          id: cached.id,
          harness: cached.harness,
          name: cached.name,
          vendor: cached.vendor,
          account: cached.account,
          planName: cached.planName,
          source: cached.source,
          updatedAt: new Date(nowMs).toISOString(),
          windows: [],
          error: reason ?? "Couldn't refresh this quota",
        });
      }
      continue;
    }
    // Never had data, but we know why the lookup failed (e.g. rate limited): say so instead of hiding the tool.
    const meta = reason ? PROVIDER_META[id] : undefined;
    if (meta && reason) {
      items.push({ ...meta, source: "live", updatedAt: new Date(nowMs).toISOString(), windows: [], error: reason });
    }
  }
  return items;
}

const PROVIDER_META: Record<string, Pick<HarnessLimitCard, "id" | "harness" | "name" | "vendor">> = {
  claude: { id: "claude", harness: "claude", name: "Claude Code", vendor: "Anthropic" },
};

// Forced refreshes use the short minimum interval; normal reads use the regular TTL.
export function isCacheFresh(ageMs: number, refresh: boolean): boolean {
  return ageMs < (refresh ? MIN_FORCED_REFRESH_MS : CACHE_TTL_MS);
}

async function collectAllLimits(): Promise<LimitsPayload> {
  const prevCache = memoryCache?.payload ?? (await readDiskCache());
  const prevById = new Map<string, HarnessLimitCard>(prevCache?.items.map((item) => [item.id, item]) ?? []);

  failureReasons.clear();
  const settled = await Promise.allSettled(PROVIDERS.map((p) => withTimeout(p.run(), PROVIDER_TIMEOUT_MS)));
  const fresh = new Map<string, ProviderResult>();
  PROVIDERS.forEach((p, i) => {
    const result = settled[i]!;
    fresh.set(p.id, result.status === "fulfilled" ? result.value : null);
  });

  const payload: LimitsPayload = {
    generatedAt: new Date().toISOString(),
    items: mergeWithCache(prevById, fresh, Date.now(), failureReasons),
  };

  memoryCache = { payload, fetchedAtMs: Date.now() };
  void writeDiskCache(payload);
  return payload;
}

export async function getLimitsData(opts?: { refresh?: boolean }): Promise<LimitsPayload> {
  const refresh = opts?.refresh ?? false;
  if (memoryCache && isCacheFresh(Date.now() - memoryCache.fetchedAtMs, refresh)) {
    return memoryCache.payload;
  }
  if (inFlightPromise) return inFlightPromise;
  inFlightPromise = collectAllLimits().finally(() => {
    inFlightPromise = null;
  });
  return inFlightPromise;
}
