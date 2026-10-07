import { Database } from "bun:sqlite";
import type { Interval, Sample } from "./stats.ts";

// One reader per tool. Each turns a session file into the responses it records, with the
// time each request went out and the time its last token arrived. Readers never throw on a
// malformed line; they skip it, since these files are written by tools that change often.

export interface FileResult {
  samples: Sample[];
  /** Extra working time for tools that log activity but no per-response tokens. */
  activity?: Interval[];
}

const ms = (iso: unknown): number => (typeof iso === "string" ? Date.parse(iso) : NaN);

function jsonLines(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A line cut off mid-write, or not JSON at all.
    }
  }
  return out;
}

/**
 * Claude Code writes one line per content block as it streams, all sharing a message id.
 * The first block's parent is the line that triggered the request (the prompt or a tool
 * result), so a response runs from that line to the message's last block. That includes
 * time to first token.
 */
export function readClaude(text: string): FileResult {
  const seen = new Map<string, number>();
  const messages = new Map<string, Sample>();
  for (const e of jsonLines(text)) {
    const t = ms(e.timestamp);
    if (!Number.isFinite(t)) continue;
    const msg = e.message;
    if (e.type === "assistant" && typeof msg?.id === "string" && !e.isApiErrorMessage) {
      const existing = messages.get(msg.id);
      const out = Number(msg.usage?.output_tokens ?? 0);
      if (existing) {
        existing.end = Math.max(existing.end, t);
        existing.outputTokens = Math.max(existing.outputTokens, out);
      } else {
        const start = seen.get(e.parentUuid);
        const model = String(msg.model ?? "");
        if (start !== undefined && model && model !== "<synthetic>") {
          messages.set(msg.id, { model, start, end: t, outputTokens: out });
        }
      }
    }
    if (typeof e.uuid === "string") seen.set(e.uuid, t);
  }
  return { samples: [...messages.values()] };
}

const CODEX_TS = /^\{"timestamp":"([^"]+)"/;
const CODEX_ITEM = /"payload":\{"type":"([a-z_]+)"/;
const CODEX_ROLE = /"role":"([a-z]+)"/;

/**
 * Codex rollouts log each output item as it completes. Newer versions add a
 * token_usage_record as soon as a response finishes; older ones only log token_count,
 * which can arrive after the tool call has run, so there the response ends at its last
 * output item. A response starts at the input before it (the prompt or a tool result).
 * Tool output lines can be megabytes, so lines are classified from their first bytes and
 * only the small ones are parsed.
 */
export function readCodex(text: string): FileResult {
  let model = "";
  let inputAt: number | null = null;
  let current: { start: number; end: number } | null = null;
  let finished: { start: number; end: number } | null = null;
  const fromRecords: Sample[] = [];
  const fromCounts: Sample[] = [];
  let lastTotal = -1;

  const take = () => {
    const target = current ?? finished;
    current = null;
    finished = null;
    return target;
  };

  for (const line of text.split("\n")) {
    const head = line.slice(0, 400);
    const t = ms(CODEX_TS.exec(head)?.[1]);
    if (!Number.isFinite(t)) continue;

    if (head.includes('"type":"turn_context"')) {
      try {
        model = String(JSON.parse(line).payload?.model ?? model);
      } catch {}
      continue;
    }
    if (head.includes('"type":"token_usage_record"')) {
      let out = 0;
      try {
        out = Number(JSON.parse(line).payload?.usage?.output_tokens ?? 0);
      } catch {
        continue;
      }
      const target = take();
      if (target && model) fromRecords.push({ model, start: target.start, end: t, outputTokens: out });
      inputAt = t;
      continue;
    }
    if (head.includes('"type":"event_msg"')) {
      if (!head.includes('"type":"token_count"')) continue;
      let info: any;
      try {
        info = JSON.parse(line).payload?.info;
      } catch {
        continue;
      }
      const total = Number(info?.total_token_usage?.total_tokens ?? -1);
      // Codex repeats token_count without a new response (for rate-limit updates).
      if (!info || total === lastTotal) continue;
      lastTotal = total;
      const target = take();
      const out = Number(info.last_token_usage?.output_tokens ?? 0);
      if (target && model) fromCounts.push({ model, start: target.start, end: target.end, outputTokens: out });
      continue;
    }
    if (!head.includes('"type":"response_item"')) continue;

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
  }
  return { samples: fromRecords.length ? fromRecords : fromCounts };
}

/** Pi stores when each request started on the message and when it finished on its log line. */
export function readPi(text: string): FileResult {
  const samples: Sample[] = [];
  for (const e of jsonLines(text)) {
    const m = e.message;
    if (e.type !== "message" || m?.role !== "assistant" || !m.model) continue;
    const start = Number(m.timestamp);
    const end = ms(e.timestamp);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // ccusage prefixes Pi's models so they don't merge with the same model in other tools.
    samples.push({ model: `[pi] ${m.model}`, start, end, outputTokens: Number(m.usage?.output ?? 0) });
  }
  return { samples };
}

/**
 * Gemini CLI stamps each reply when it finishes and each tool call when it completes. A
 * reply starts at whatever came just before it: the prompt, the previous reply's last tool
 * call, or the previous reply. Older versions write one JSON document, newer ones JSONL.
 */
export function readGemini(text: string): FileResult {
  let messages: any[];
  try {
    messages = JSON.parse(text).messages ?? [];
  } catch {
    messages = jsonLines(text).filter((e) => e && typeof e.type === "string");
  }
  const samples: Sample[] = [];
  let prev: number | null = null;
  for (const m of messages) {
    const t = ms(m.timestamp);
    if (!Number.isFinite(t)) continue;
    if (m.type === "gemini" && m.tokens && m.model && prev !== null) {
      const out = Number(m.tokens.output ?? 0) + Number(m.tokens.thoughts ?? 0);
      samples.push({ model: String(m.model), start: prev, end: t, outputTokens: out });
    }
    let last = t;
    for (const call of Array.isArray(m.toolCalls) ? m.toolCalls : []) {
      const c = ms(call?.timestamp);
      if (Number.isFinite(c) && c > last) last = c;
    }
    prev = last;
  }
  return { samples };
}

function hrTime(value: unknown): number {
  if (Array.isArray(value) && value.length === 2) return Number(value[0]) * 1000 + Number(value[1]) / 1e6;
  if (typeof value === "string") return Date.parse(value);
  if (typeof value === "number") {
    // Epoch nanoseconds, microseconds or milliseconds, told apart by size.
    if (value > 1e17) return value / 1e6;
    if (value > 1e14) return value / 1e3;
    return value;
  }
  return NaN;
}

/** ccusage drops these suffixes so long-context variants price as their base model. */
function copilotModel(name: string): string {
  return name.replace(/-1m(-internal)?$/, "");
}

/** Copilot's OpenTelemetry file export: each chat span has its start, end and token counts. */
export function readCopilotOtel(text: string): FileResult {
  const samples: Sample[] = [];
  for (const r of jsonLines(text)) {
    const a = r?.attributes ?? {};
    const isChat = a["gen_ai.operation.name"] === "chat" || String(r?.name ?? "").startsWith("chat ");
    if (!isChat) continue;
    const start = hrTime(r.startTime);
    const end = hrTime(r.endTime);
    const model = String(a["gen_ai.response.model"] ?? a["gen_ai.request.model"] ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || !model) continue;
    samples.push({ model: copilotModel(model), start, end, outputTokens: Number(a["gen_ai.usage.output_tokens"] ?? 0) });
  }
  return { samples };
}

/** Copilot's session-state log has timestamps on every event but tokens only at shutdown. */
export function readCopilotEvents(text: string): FileResult {
  const activity: Interval[] = [];
  for (const e of jsonLines(text)) {
    const t = ms(e.timestamp);
    if (Number.isFinite(t)) activity.push([t, t]);
  }
  return { samples: [], activity };
}

/** OpenCode records when each assistant message was created and completed. */
export function readOpencode(dbPath: string): FileResult {
  const samples: Sample[] = [];
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query("select data from message").all() as { data: string }[];
    for (const r of rows) {
      let m: any;
      try {
        m = JSON.parse(r.data);
      } catch {
        continue;
      }
      if (m.role !== "assistant" || !m.modelID) continue;
      const start = Number(m.time?.created);
      const end = Number(m.time?.completed);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const out = Number(m.tokens?.output ?? 0) + Number(m.tokens?.reasoning ?? 0);
      samples.push({ model: String(m.modelID), start, end, outputTokens: out });
    }
  } finally {
    db.close();
  }
  return { samples };
}

// Antigravity keeps protobuf blobs in SQLite. Only the few fields read here are decoded;
// the field numbers follow ccusage's Antigravity parser.

type Field = { n: number; v: bigint | Uint8Array };

function decodeProto(b: Uint8Array): Field[] {
  const out: Field[] = [];
  let i = 0;
  const varint = (): bigint => {
    let r = 0n;
    let shift = 0n;
    for (;;) {
      const x = b[i++];
      if (x === undefined || shift > 63n) throw new Error("bad varint");
      r |= BigInt(x & 0x7f) << shift;
      shift += 7n;
      if (!(x & 0x80)) return r;
    }
  };
  try {
    while (i < b.length) {
      const key = varint();
      const n = Number(key >> 3n);
      const wire = Number(key & 7n);
      if (n === 0) break;
      if (wire === 0) out.push({ n, v: varint() });
      else if (wire === 2) {
        const len = Number(varint());
        if (i + len > b.length) break;
        out.push({ n, v: b.subarray(i, i + len) });
        i += len;
      } else if (wire === 1) i += 8;
      else if (wire === 5) i += 4;
      else break;
    }
  } catch {
    // Keep the fields read before the damage.
  }
  return out;
}

const bytesField = (f: Field[], n: number) => f.find((x) => x.n === n && x.v instanceof Uint8Array)?.v as Uint8Array | undefined;
const numField = (f: Field[], n: number) => {
  const v = f.findLast((x) => x.n === n && typeof x.v === "bigint")?.v as bigint | undefined;
  return v === undefined ? undefined : Number(v);
};
const textField = (f: Field[], n: number) => {
  const b = bytesField(f, n);
  const s = b ? new TextDecoder().decode(b).trim() : "";
  return s || undefined;
};

function protoTime(b: Uint8Array | undefined): number {
  if (!b) return NaN;
  const f = decodeProto(b);
  const seconds = numField(f, 1) ?? 0;
  return seconds > 0 ? seconds * 1000 + (numField(f, 2) ?? 0) / 1e6 : NaN;
}

const ANTIGRAVITY_IDS: Record<number, string> = {
  246: "gemini-2.5-pro",
  312: "gemini-2.5-flash",
  313: "gemini-2.5-flash-thinking",
  329: "gemini-2.5-flash-thinking",
  330: "gemini-2.5-flash-lite",
  281: "claude-4-sonnet",
  282: "claude-4-sonnet",
  290: "claude-4-opus",
  291: "claude-4-opus",
  333: "claude-4.5-sonnet",
  334: "claude-4.5-sonnet",
  340: "claude-4.5-haiku",
  341: "claude-4.5-haiku",
  342: "model_openai_gpt_oss_120b_medium",
};

const ANTIGRAVITY_ALIASES: Record<string, string> = {
  model_placeholder_m318: "gemini-3.8-flash-high",
  model_placeholder_m319: "gemini-3.8-flash-medium",
  model_placeholder_m320: "gemini-3.8-flash-low",
  model_placeholder_m298: "gemini-3.7-flash-high",
  model_placeholder_m299: "gemini-3.7-flash-medium",
  model_placeholder_m300: "gemini-3.7-flash-low",
  model_placeholder_m71: "gemini-3.6-flash-high",
  model_placeholder_m72: "gemini-3.6-flash-medium",
  model_placeholder_m73: "gemini-3.6-flash-low",
  model_placeholder_m26: "claude-opus-4-6",
  model_placeholder_m35: "claude-sonnet-4-6",
  model_placeholder_m36: "gemini-3.1-pro",
  model_placeholder_m37: "gemini-3.1-pro",
  model_placeholder_m16: "gemini-3.1-pro",
  model_placeholder_m18: "gemini-3-flash-preview",
  model_placeholder_m84: "gemini-3-flash-preview",
  model_placeholder_m47: "gemini-3-flash-preview",
  model_placeholder_m132: "gemini-3.5-flash-high",
  model_placeholder_m133: "gemini-3.5-flash-high",
  model_placeholder_m187: "gemini-3.5-flash-extra-low",
  model_placeholder_m20: "gemini-3.5-flash-medium",
  model_openai_gpt_oss_120b_medium: "gpt-oss-120b-medium",
  "gemini 3.8 flash": "gemini-3.8-flash",
  "gemini 3.8 flash thinking": "gemini-3.8-flash",
  "gemini 3.7 flash": "gemini-3.7-flash",
  "gemini 3.7 flash thinking": "gemini-3.7-flash",
  "gemini 3.7 pro": "gemini-3.7-pro",
  "gemini 3.7 pro thinking": "gemini-3.7-pro",
  "gemini 3.6 flash": "gemini-3.6-flash",
  "gemini 3 flash": "gemini-3.6-flash",
  "gemini 3.6 pro": "gemini-3.6-pro",
  "gemini 3 pro": "gemini-3-pro",
  "gemini 3 pro thinking": "gemini-3-pro",
  "gemini 2.5 flash": "gemini-2.5-flash",
  "gemini 2.5 pro": "gemini-2.5-pro",
  "gemini 2.0 flash": "gemini-2.0-flash",
  "gemini 2 flash": "gemini-2.0-flash",
  "gemini 2.0 pro": "gemini-2.0-pro",
  "gemini 1.5 flash": "gemini-1.5-flash",
  "gemini 1.5 pro": "gemini-1.5-pro",
  "gemini-pro-default": "gemini-3.1-pro",
  "gemini-pro-agent": "gemini-3.1-pro",
  "gemini-3-flash-agent": "gemini-3.5-flash-high",
  "gemini-3-flash-agent-a": "gemini-3.5-flash-high",
  "gemini-3-flash-agent-b": "gemini-3.5-flash-high",
  "gemini-3-flash-a": "gemini-3.5-flash-high",
  "gemini-3-flash-b": "gemini-3.5-flash-high",
  "gemini-3-flash-c": "gemini-3-flash-preview",
  "gemini-3-flash": "gemini-3-flash-preview",
  "gemini-3.5-flash-low": "gemini-3.5-flash-medium",
  "gemini-3.1-pro-high": "gemini-3.1-pro",
  "gemini-3.1-pro-low": "gemini-3.1-pro",
  "gemini-3-pro-high": "gemini-3-pro",
  "gemini-3-pro-low": "gemini-3-pro",
  "claude 3.7 sonnet": "claude-3-7-sonnet",
  "claude 3.7 sonnet thinking": "claude-3-7-sonnet",
  "claude 3.5 sonnet": "claude-3-5-sonnet",
  "claude 3.5 haiku": "claude-3-5-haiku",
  "claude 3 opus": "claude-3-opus",
};

/** The model name ccusage reports for a step, so speeds line up with the Models table. */
export function antigravityModel(text: string | undefined, id: number | undefined): string | null {
  if (text) {
    const lower = text.trim().toLowerCase();
    const effort = /^gemini (3\.[678]) flash \((high|medium|low)\)$/.exec(lower);
    if (effort) return `gemini-${effort[1]}-flash-${effort[2]}`;
    const base = lower.includes("(") ? lower.slice(0, lower.indexOf("(")).trim() : lower;
    if (ANTIGRAVITY_ALIASES[base]) return ANTIGRAVITY_ALIASES[base]!;
    const dashed = base.replace(/ /g, "-");
    return /^(gemini|claude|gpt)-/.test(dashed) ? dashed : text.trim();
  }
  if (!id) return null;
  const name = ANTIGRAVITY_IDS[id] ?? (id >= 1000 ? `model_placeholder_m${id - 1000}` : `antigravity-model-${id}`);
  return ANTIGRAVITY_ALIASES[name] ?? name;
}

/** Each Antigravity step that called a model records when it was created and finished. */
export function readAntigravity(dbPath: string): FileResult {
  const samples: Sample[] = [];
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query("select metadata from steps").all() as { metadata: unknown }[];
    for (const r of rows) {
      if (!(r.metadata instanceof Uint8Array)) continue;
      const f = decodeProto(r.metadata);
      const usageBytes = bytesField(f, 9);
      if (!usageBytes) continue;
      const usage = decodeProto(usageBytes);
      const info = bytesField(f, 24);
      const infoFields = info ? decodeProto(info) : [];
      const model = antigravityModel(
        textField(infoFields, 12) ?? textField(infoFields, 8),
        numField(infoFields, 1) || numField(usage, 1),
      );
      const start = protoTime(bytesField(f, 1));
      const end = protoTime(bytesField(f, 8));
      if (!model || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      samples.push({ model, start, end, outputTokens: numField(usage, 3) ?? 0 });
    }
  } catch {
    // An older database without the steps table.
  } finally {
    db.close();
  }
  return { samples };
}
