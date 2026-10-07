import { describe, expect, test } from "bun:test";
import {
  antigravityModel,
  readClaude,
  readCodex,
  readCopilotEvents,
  readCopilotOtel,
  readGemini,
  readPi,
} from "./readers.ts";

const lines = (...rows: (object | string)[]) => rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n");
const at = (s: number) => new Date(Date.UTC(2026, 9, 5, 12, 0, s)).toISOString();
const t = (s: number) => Date.parse(at(s));

describe("readClaude", () => {
  test("times a message from the line that triggered it to its last streamed block", () => {
    const text = lines(
      { type: "user", uuid: "u1", timestamp: at(0) },
      { type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: at(4), message: { id: "msg_1", model: "claude-opus-5-5", usage: { output_tokens: 300 } } },
      { type: "assistant", uuid: "a2", parentUuid: "a1", timestamp: at(6), message: { id: "msg_1", model: "claude-opus-5-5", usage: { output_tokens: 300 } } },
      { type: "user", uuid: "u2", parentUuid: "a2", timestamp: at(9) },
      { type: "assistant", uuid: "a3", parentUuid: "u2", timestamp: at(11), message: { id: "msg_2", model: "claude-opus-5-5", usage: { output_tokens: 80 } } },
    );
    expect(readClaude(text).samples).toEqual([
      { model: "claude-opus-5-5", start: t(0), end: t(6), outputTokens: 300 },
      { model: "claude-opus-5-5", start: t(9), end: t(11), outputTokens: 80 },
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
    messages: [
      { type: "user", timestamp: at(0) },
      { type: "gemini", timestamp: at(10), model: "gemini-3-flash-preview", tokens: { output: 100, thoughts: 50 }, toolCalls: [{ timestamp: at(12) }] },
      { type: "gemini", timestamp: at(20), model: "gemini-3-flash-preview", tokens: { output: 200, thoughts: 0 } },
    ],
  };

  test("starts a reply after the prompt or the previous reply's last tool call, counting thoughts", () => {
    expect(readGemini(JSON.stringify(session)).samples).toEqual([
      { model: "gemini-3-flash-preview", start: t(0), end: t(10), outputTokens: 150 },
      { model: "gemini-3-flash-preview", start: t(12), end: t(20), outputTokens: 200 },
    ]);
  });

  test("reads the JSONL layout too", () => {
    expect(readGemini(lines({ sessionId: "s" }, ...session.messages)).samples).toHaveLength(2);
  });
});

test("readCopilotOtel reads chat spans with hrTime start and end", () => {
  const text = lines(
    {
      type: "span",
      name: "chat claude-opus-4.6-1m-internal",
      startTime: [1791204620, 0],
      endTime: [1791204625, 500_000_000],
      attributes: { "gen_ai.operation.name": "chat", "gen_ai.response.model": "claude-opus-4.6-1m-internal", "gen_ai.usage.output_tokens": 300 },
    },
    { type: "span", name: "invoke_agent", startTime: [1, 0], endTime: [2, 0], attributes: { "gen_ai.operation.name": "invoke_agent" } },
  );
  expect(readCopilotOtel(text).samples).toEqual([
    { model: "claude-opus-4.6", start: 1791204620000, end: 1791204625500, outputTokens: 300 },
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
