import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  antigravityModel,
  antigravityStep,
  readClaude,
  readCodex,
  readCopilotEvents,
  readCopilotOtel,
  readGemini,
  readOpencode,
  readPi,
} from "./readers.ts";

const lines = (...rows: (object | string)[]) => rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n");
const at = (s: number) => new Date(Date.UTC(2026, 9, 5, 12, 0, s)).toISOString();
const t = (s: number) => Date.parse(at(s));

describe("readClaude", () => {
  test("times a message from the line that triggered it to its last streamed block", () => {
    const text = lines(
      { type: "user", uuid: "u1", timestamp: at(0) },
      { type: "assistant", uuid: "a1", parentUuid: "u1", sessionId: "s1", timestamp: at(4), message: { id: "msg_1", model: "claude-opus-5-5", usage: { output_tokens: 300 } } },
      { type: "assistant", uuid: "a2", parentUuid: "a1", timestamp: at(6), message: { id: "msg_1", model: "claude-opus-5-5", usage: { output_tokens: 300 } } },
      { type: "user", uuid: "u2", parentUuid: "a2", timestamp: at(9) },
      { type: "assistant", uuid: "a3", parentUuid: "u2", timestamp: at(11), message: { id: "msg_2", model: "claude-opus-5-5", usage: { output_tokens: 80 } } },
    );
    expect(readClaude(text).samples).toEqual([
      { model: "claude-opus-5-5", start: t(0), end: t(6), outputTokens: 300, session: "s1" },
      { model: "claude-opus-5-5", start: t(9), end: t(11), outputTokens: 80, session: undefined },
    ]);
  });

  test("skips synthetic messages, API errors and messages whose trigger isn't in the file", () => {
    const text = lines(
      { type: "user", uuid: "u1", timestamp: at(0) },
      { type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: at(1), message: { id: "m1", model: "<synthetic>", usage: { output_tokens: 0 } } },
      { type: "assistant", uuid: "a2", parentUuid: "u1", timestamp: at(2), isApiErrorMessage: true, message: { id: "m2", model: "claude-opus-5-5" } },
      { type: "assistant", uuid: "a3", parentUuid: "missing", timestamp: at(3), message: { id: "m3", model: "claude-opus-5-5" } },
      "not json",
    );
    expect(readClaude(text).samples).toEqual([]);
  });
});

describe("readCodex", () => {
  const item = (s: number, payload: object) => ({ timestamp: at(s), type: "response_item", payload });
  const context = { timestamp: at(0), type: "turn_context", payload: { model: "gpt-6.1-sol" } };

  test("uses token_usage_record, which lands as soon as the response finishes", () => {
    const text = lines(
      context,
      item(1, { type: "message", role: "user", content: [] }),
      item(5, { type: "reasoning" }),
      item(8, { type: "custom_tool_call", call_id: "c1" }),
      { timestamp: at(8), type: "token_usage_record", payload: { usage: { output_tokens: 149 } } },
      item(10, { type: "custom_tool_call_output", call_id: "c1" }),
      { timestamp: at(10), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 1 }, last_token_usage: { output_tokens: 149 } } } },
      item(14, { type: "message", role: "assistant" }),
      { timestamp: at(15), type: "token_usage_record", payload: { usage: { output_tokens: 60 } } },
    );
    expect(readCodex(text).samples).toEqual([
      { model: "gpt-6.1-sol", start: t(1), end: t(8), outputTokens: 149 },
      { model: "gpt-6.1-sol", start: t(10), end: t(15), outputTokens: 60 },
    ]);
  });

  test("falls back to token_count, ending the response at its last output item", () => {
    const count = (s: number, total: number, out: number) => ({
      timestamp: at(s),
      type: "event_msg",
      payload: { type: "token_count", info: { total_token_usage: { total_tokens: total }, last_token_usage: { output_tokens: out } } },
    });
    const text = lines(
      context,
      item(1, { type: "message", role: "user" }),
      item(6, { type: "function_call" }),
      item(9, { type: "function_call_output" }),
      count(9, 500, 120),
      count(9, 500, 120),
      item(12, { type: "message", role: "assistant" }),
      count(12, 900, 40),
    );
    expect(readCodex(text).samples).toEqual([
      { model: "gpt-6.1-sol", start: t(1), end: t(6), outputTokens: 120 },
      { model: "gpt-6.1-sol", start: t(9), end: t(12), outputTokens: 40 },
    ]);
  });
});

test("readPi takes the start from the message and the end from its log line", () => {
  const text = lines(
    { type: "message", timestamp: at(0), message: { role: "user", timestamp: t(0) } },
    { type: "message", timestamp: at(5), message: { role: "assistant", model: "deepseek-v4.1-flash", timestamp: t(1), usage: { output: 400 } } },
  );
  expect(readPi(text).samples).toEqual([{ model: "[pi] deepseek-v4.1-flash", start: t(1), end: t(5), outputTokens: 400 }]);
});

describe("readGemini", () => {
  const session = {
    sessionId: "g1",
    messages: [
      { type: "user", timestamp: at(0) },
      { type: "gemini", timestamp: at(10), model: "gemini-3-flash-preview", tokens: { output: 100, thoughts: 50 }, toolCalls: [{ timestamp: at(12) }] },
      { type: "gemini", timestamp: at(20), model: "gemini-3-flash-preview", tokens: { output: 200, thoughts: 0 } },
    ],
  };

  test("starts a reply after the prompt or the previous reply's last tool call, counting thoughts", () => {
    expect(readGemini(JSON.stringify(session)).samples).toEqual([
      { model: "gemini-3-flash-preview", start: t(0), end: t(10), outputTokens: 150, session: "g1" },
      { model: "gemini-3-flash-preview", start: t(12), end: t(20), outputTokens: 200, session: "g1" },
    ]);
  });

  test("reads the JSONL layout too", () => {
    const samples = readGemini(lines({ sessionId: "g1" }, ...session.messages)).samples;
    expect(samples).toHaveLength(2);
    expect(samples[0]!.session).toBe("g1");
  });
});

test("readCopilotOtel reads chat spans with hrTime start and end", () => {
  const text = lines(
    {
      type: "span",
      name: "chat claude-opus-4.6-1m-internal",
      startTime: [1791204620, 0],
      endTime: [1791204625, 500_000_000],
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.response.model": "claude-opus-4.6-1m-internal",
        "gen_ai.usage.output_tokens": 300,
        "gen_ai.conversation.id": "c1",
      },
    },
    { type: "span", name: "invoke_agent", startTime: [1, 0], endTime: [2, 0], attributes: { "gen_ai.operation.name": "invoke_agent" } },
  );
  expect(readCopilotOtel(text).samples).toEqual([
    { model: "claude-opus-4.6", start: 1791204620000, end: 1791204625500, outputTokens: 300, session: "c1" },
  ]);
});

test("readCopilotEvents turns session events into activity without speed samples", () => {
  const result = readCopilotEvents(lines({ type: "session.start", timestamp: at(0) }, { type: "session.shutdown", timestamp: at(30) }));
  expect(result.samples).toEqual([]);
  expect(result.activity).toEqual([[t(0), t(0)], [t(30), t(30)]]);
});

test("antigravityModel matches ccusage's model names", () => {
  expect(antigravityModel("Gemini 3.8 Flash (High)", 1318)).toBe("gemini-3.8-flash-high");
  expect(antigravityModel("gemini-pro-default", undefined)).toBe("gemini-3.1-pro");
  expect(antigravityModel(undefined, 1318)).toBe("gemini-3.8-flash-high");
  expect(antigravityModel(undefined, 1035)).toBe("claude-sonnet-4-6");
  expect(antigravityModel(undefined, 1265)).toBe("model_placeholder_m265");
  expect(antigravityModel(undefined, 246)).toBe("gemini-2.5-pro");
  expect(antigravityModel(undefined, 342)).toBe("gpt-oss-120b-medium");
  expect(antigravityModel(undefined, undefined)).toBeNull();
});

describe("readOpencode", () => {
  function withDb(fill: (db: Database) => void, check: (path: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "tl-opencode-"));
    const path = join(dir, "opencode.db");
    const db = new Database(path);
    db.run("create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text)");
    db.run("create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text)");
    fill(db);
    db.close();
    try {
      check(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // Row columns hold a migration time on purpose: the reader must use the times in the data.
  const MIGRATED = 1;
  const message = (db: Database, id: string, data: object) =>
    db.run("insert into message values (?, 'ses_1', ?, ?, ?)", [id, MIGRATED, MIGRATED, JSON.stringify(data)]);
  const part = (db: Database, id: string, messageId: string, data: object) =>
    db.run("insert into part values (?, ?, 'ses_1', ?, ?, ?)", [id, messageId, MIGRATED, MIGRATED, JSON.stringify(data)]);

  test("times each step from its request to its last token, leaving tool runs out", () => {
    withDb(
      (db) => {
        message(db, "m1", { role: "assistant", modelID: "kimi", time: { created: t(0), completed: t(60) }, tokens: { output: 900 } });
        part(db, "p1", "m1", { type: "step-start" });
        part(db, "p2", "m1", { type: "reasoning", time: { start: t(2), end: t(4) } });
        part(db, "p3", "m1", { type: "tool", state: { time: { start: t(6), end: t(40) } } });
        part(db, "p4", "m1", { type: "step-finish", tokens: { output: 300, reasoning: 100 } });
        part(db, "p5", "m1", { type: "step-start" });
        part(db, "p6", "m1", { type: "text", time: { start: t(41), end: t(50) } });
        part(db, "p7", "m1", { type: "step-finish", tokens: { output: 500, reasoning: 0 } });
      },
      (path) => {
        expect(readOpencode(path).samples).toEqual([
          { model: "kimi", session: "ses_1", start: t(0), end: t(6), outputTokens: 400, firstOutputAt: t(2) },
          { model: "kimi", session: "ses_1", start: t(40), end: t(50), outputTokens: 500, firstOutputAt: t(41) },
        ]);
      },
    );
  });

  test("falls back to the message's own times when it has no parts", () => {
    withDb(
      (db) => message(db, "m1", { role: "assistant", modelID: "glm", time: { created: t(0), completed: t(9) }, tokens: { output: 200, reasoning: 50 } }),
      (path) => {
        expect(readOpencode(path).samples).toEqual([{ model: "glm", session: "ses_1", start: t(0), end: t(9), outputTokens: 250 }]);
      },
    );
  });
});

// Just enough protobuf to build an Antigravity step: varints and length-delimited fields.
function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}
const num = (field: number, value: number) => [...varint(field * 8), ...varint(value)];
const msg = (field: number, bytes: number[]) => [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
const time = (field: number, seconds: number) => msg(field, num(1, seconds));

test("antigravityStep reads tokens the way ccusage counts them", () => {
  const usage = [...num(1, 1318), ...num(2, 4680), ...num(3, 472), ...num(5, 220157), ...num(9, 83), ...num(10, 389)];
  const step = antigravityStep(new Uint8Array([...time(1, 1_791_500_000), ...time(8, 1_791_500_009), ...msg(9, usage)]));
  expect(step).toEqual({
    model: "gemini-3.8-flash-high",
    start: 1_791_500_000_000,
    end: 1_791_500_009_000,
    inputTokens: 4680,
    outputTokens: 389,
    thinkingTokens: 83,
    cacheReadTokens: 220157,
  });
});

test("antigravityStep falls back to reply plus thinking minus thinking, and skips steps without usage", () => {
  const usage = [...num(1, 1318), ...num(3, 300), ...num(9, 100)];
  expect(antigravityStep(new Uint8Array([...time(1, 100), ...time(8, 110), ...msg(9, usage)]))!.outputTokens).toBe(200);
  expect(antigravityStep(new Uint8Array([...time(1, 100), ...time(8, 110)]))).toBeNull();
});
