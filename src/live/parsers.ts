import type { HarnessId, LiveEvent } from "../types.ts";

// Line-at-a-time readers for following session files as they grow. Each keeps the state it
// needs between lines (the model in use, when the request went out), so a file can be fed in
// chunks as new lines land. A response that is still streaming comes out again, under the
// same id, each time its counts grow. Malformed lines are skipped: a line can be cut off
// mid-write, and these formats change often.

export type LiveUsage = Omit<LiveEvent, "cost">;

export interface LineParser {
  feed(line: string): LiveUsage[];
}

const ms = (iso: unknown): number => (typeof iso === "string" ? Date.parse(iso) : NaN);
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

function parse(line: string): any {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** The last folder of a path, for either separator. */
export function folderName(path: unknown): string | undefined {
  if (typeof path !== "string") return undefined;
  return path.split(/[\\/]/).filter(Boolean).pop();
}

/**
 * Claude Code writes one line per content block, all sharing a message id and repeating the
 * usage so far. The first block's parent is the prompt or tool result that sent the request.
 */
export function claudeParser(): LineParser {
  const seen = new Map<string, number>();
  const messages = new Map<string, LiveUsage>();
  return {
    feed(line) {
      const e = parse(line);
      const t = ms(e?.timestamp);
      if (!e || !Number.isFinite(t)) return [];
      if (typeof e.uuid === "string") seen.set(e.uuid, t);
      const msg = e.message;
      if (e.type !== "assistant" || typeof msg?.id !== "string" || e.isApiErrorMessage) return [];
      const model = String(msg.model ?? "");
      if (!model || model === "<synthetic>") return [];
      const u = msg.usage ?? {};
      const id = `claude:${msg.id}:${e.requestId ?? ""}`;
      const prev = messages.get(id);
      const next: LiveUsage = {
        id,
        harness: "claude",
        model,
        start: prev?.start ?? seen.get(e.parentUuid),
        at: Math.max(prev?.at ?? t, t),
        session: e.sessionId || prev?.session,
        project: folderName(e.cwd) ?? prev?.project,
        inputTokens: Math.max(prev?.inputTokens ?? 0, num(u.input_tokens)),
        outputTokens: Math.max(prev?.outputTokens ?? 0, num(u.output_tokens)),
        cacheCreationTokens: Math.max(prev?.cacheCreationTokens ?? 0, num(u.cache_creation_input_tokens)),
        cacheReadTokens: Math.max(prev?.cacheReadTokens ?? 0, num(u.cache_read_input_tokens)),
      };
      if (next.start === undefined) delete next.start;
      messages.set(id, next);
      return [{ ...next }];
    },
  };
}

const CODEX_TS = /^\{"timestamp":"([^"]+)"/;
const CODEX_ITEM = /"payload":\{"type":"([a-z_]+)"/;
const CODEX_ROLE = /"role":"([a-z]+)"/;

/**
 * Codex logs each output item as it completes, then the response's token counts: a
 * token_usage_record in newer versions, a token_count event in older ones (newer versions
 * write both, so once a file has records its counts are ignored). Input tokens include the
 * cached ones. Tool output lines can be megabytes, so lines are classified from their first
 * bytes and only small ones are parsed.
 */
export function codexParser(fileSession?: string): LineParser {
  let model = "";
  let session = fileSession;
  let project: string | undefined;
  let inputAt: number | null = null;
  let current: { start: number; end: number } | null = null;
  let finished: { start: number; end: number } | null = null;
  let hasRecords = false;
  let lastTotal = -1;
  let count = 0;

  const take = () => {
    const target = current ?? finished;
    current = null;
    finished = null;
    return target;
  };

  const emit = (usage: any, start: number | undefined, at: number): LiveUsage[] => {
    if (!model || !usage) return [];
    const input = num(usage.input_tokens);
    const cached = Math.min(input, num(usage.cached_input_tokens));
    count += 1;
    const event: LiveUsage = {
      id: `codex:${session ?? "?"}:${count}`,
      harness: "codex",
      model,
      at,
      ...(start !== undefined ? { start } : {}),
      ...(session ? { session } : {}),
      ...(project ? { project } : {}),
      inputTokens: input - cached,
      outputTokens: num(usage.output_tokens),
      cacheCreationTokens: 0,
      cacheReadTokens: cached,
    };
    return [event];
  };

  return {
    feed(line) {
      const head = line.slice(0, 400);
      const t = ms(CODEX_TS.exec(head)?.[1]);
      if (!Number.isFinite(t)) return [];

      if (head.includes('"type":"session_meta"') || head.includes('"type":"turn_context"')) {
        const p = parse(line)?.payload;
        if (p?.model) model = String(p.model);
        if (p?.cwd) project = folderName(p.cwd) ?? project;
        if (head.includes('"type":"session_meta"') && typeof p?.id === "string") session = fileSession ?? p.id;
        return [];
      }
      if (head.includes('"type":"token_usage_record"')) {
        hasRecords = true;
        const usage = parse(line)?.payload?.usage;
        const target = take();
        inputAt = t;
        return emit(usage, target?.start, t);
      }
      if (head.includes('"type":"event_msg"')) {
        if (!head.includes('"type":"token_count"') || hasRecords) return [];
        const info = parse(line)?.payload?.info;
        const total = num(info?.total_token_usage?.total_tokens ?? -1);
        // Codex repeats token_count without a new response (for rate-limit updates).
        if (!info || total === lastTotal) return [];
        lastTotal = total;
        const target = take();
        return emit(info.last_token_usage, target?.start, target?.end ?? t);
      }
      if (!head.includes('"type":"response_item"')) return [];

      const item = CODEX_ITEM.exec(head)?.[1] ?? "";
      const role = item === "message" ? CODEX_ROLE.exec(head)?.[1] : undefined;
      const isInput = item.endsWith("_output") || (item === "message" && role !== "assistant");
      if (isInput) {
        if (current) finished = current;
        current = null;
        inputAt = t;
      } else if (current) {
        current.end = t;
      } else {
        current = { start: inputAt ?? t, end: t };
      }
      return [];
    },
  };
}

/** Pi stores when each request started on the message and when it finished on its log line. */
export function piParser(fileSession?: string): LineParser {
  let project: string | undefined;
  let count = 0;
  return {
    feed(line) {
      const e = parse(line);
      if (!e) return [];
      if (e.type === "session" && e.cwd) project = folderName(e.cwd);
      const m = e.message;
      if (e.type !== "message" || m?.role !== "assistant" || !m.model) return [];
      const at = ms(e.timestamp);
      if (!Number.isFinite(at)) return [];
      const start = Number(m.timestamp);
      const u = m.usage ?? {};
      count += 1;
      return [{
        id: `pi:${fileSession ?? "?"}:${typeof e.id === "string" ? e.id : count}`,
        harness: "pi",
        // ccusage prefixes Pi's models so they don't merge with the same model in other tools.
        model: `[pi] ${m.model}`,
        at,
        ...(Number.isFinite(start) && start <= at ? { start } : {}),
        ...(fileSession ? { session: fileSession } : {}),
        ...(project ? { project } : {}),
        inputTokens: num(u.input),
        outputTokens: num(u.output),
        cacheCreationTokens: num(u.cacheWrite),
        cacheReadTokens: num(u.cacheRead),
      }];
    },
  };
}

/**
 * Gemini CLI's JSONL chats stamp each reply when it finishes; it starts at whatever came just
 * before it. Input tokens include the cached ones, and thinking counts as output. The older
 * single-document format is rewritten in place, so its lines never parse and it is skipped.
 */
export function geminiParser(): LineParser {
  let session: string | undefined;
  let prev: number | null = null;
  return {
    feed(line) {
      const m = parse(line);
      if (!m || typeof m !== "object") return [];
      if (typeof m.sessionId === "string") session = m.sessionId;
      const t = ms(m.timestamp);
      if (!Number.isFinite(t) || typeof m.type !== "string") return [];
      const out: LiveUsage[] = [];
      if (m.type === "gemini" && m.tokens && m.model) {
        const input = num(m.tokens.input);
        const cached = Math.min(input, num(m.tokens.cached));
        out.push({
          id: `gemini:${session ?? "?"}:${m.id ?? t}`,
          harness: "gemini",
          model: String(m.model),
          at: t,
          ...(prev !== null ? { start: prev } : {}),
          ...(session ? { session } : {}),
          inputTokens: input - cached,
          outputTokens: num(m.tokens.output) + num(m.tokens.thoughts),
          cacheCreationTokens: 0,
          cacheReadTokens: cached,
        });
      }
      let last = t;
      for (const call of Array.isArray(m.toolCalls) ? m.toolCalls : []) {
        const c = ms(call?.timestamp);
        if (Number.isFinite(c) && c > last) last = c;
      }
      prev = last;
      return out;
    },
  };
}

function hrTime(value: unknown): number {
  if (Array.isArray(value) && value.length === 2) return Number(value[0]) * 1000 + Number(value[1]) / 1e6;
  if (typeof value === "string") return Date.parse(value);
  if (typeof value === "number") {
    if (value > 1e17) return value / 1e6;
    if (value > 1e14) return value / 1e3;
    return value;
  }
  return NaN;
}

/** Copilot's OpenTelemetry export: one chat span per response, with its own token counts. */
export function copilotOtelParser(): LineParser {
  return {
    feed(line) {
      const r = parse(line);
      const a = r?.attributes;
      if (!a) return [];
      const isChat = a["gen_ai.operation.name"] === "chat" || String(r.name ?? "").startsWith("chat ");
      const start = hrTime(r.startTime);
      const at = hrTime(r.endTime);
      const model = String(a["gen_ai.response.model"] ?? a["gen_ai.request.model"] ?? "").replace(/-1m(-internal)?$/, "");
      if (!isChat || !model || !Number.isFinite(at)) return [];
      const input = num(a["gen_ai.usage.input_tokens"]);
      const cached = Math.min(input, num(a["gen_ai.usage.cache_read.input_tokens"] ?? a["gen_ai.usage.cache_read_input_tokens"]));
      const session = a["gen_ai.conversation.id"] ?? a["copilot_chat.session_id"] ?? a["session.id"];
      const spanId = r.spanContext?.spanId ?? r.spanId ?? r.context?.span_id ?? `${start}:${at}`;
      return [{
        id: `copilot:${spanId}`,
        harness: "copilot",
        model,
        at,
        ...(Number.isFinite(start) ? { start } : {}),
        ...(typeof session === "string" ? { session } : {}),
        inputTokens: input - cached,
        outputTokens: num(a["gen_ai.usage.output_tokens"]),
        cacheCreationTokens: num(a["gen_ai.usage.cache_creation.input_tokens"]),
        cacheReadTokens: cached,
      }];
    },
  };
}

/** Tools followed live: appended log lines, or (Antigravity) a database polled for new steps. */
export const LIVE_TOOLS: HarnessId[] = ["claude", "codex", "pi", "gemini", "copilot", "antigravity"];

export function parserFor(harness: HarnessId, path: string, session?: string): LineParser | null {
  switch (harness) {
    case "claude":
      return claudeParser();
    case "codex":
      return codexParser(session);
    case "pi":
      return piParser(session);
    case "gemini":
      return geminiParser();
    case "copilot":
      // Copilot's session-state log has tokens only at shutdown.
      return /[\\/]session-state[\\/]/.test(path) ? null : copilotOtelParser();
    default:
      return null;
  }
}
