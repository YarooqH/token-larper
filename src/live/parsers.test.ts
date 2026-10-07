import { describe, expect, test } from "bun:test";
import { claudeParser, codexParser, copilotOtelParser, folderName, geminiParser, piParser, type LineParser, type LiveUsage } from "./parsers.ts";

const T0 = Date.parse("2026-10-08T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const feedAll = (p: LineParser, lines: unknown[]): LiveUsage[] => lines.flatMap((l) => p.feed(typeof l === "string" ? l : JSON.stringify(l)));

describe("claudeParser", () => {
  test("times a response from its parent line and grows it as blocks stream in", () => {
    const p = claudeParser();
    const out = feedAll(p, [
      { type: "user", uuid: "u1", timestamp: at(0), cwd: "F:\\code\\token-larper", sessionId: "s1" },
      {
        type: "assistant", uuid: "a1", parentUuid: "u1", requestId: "r1", sessionId: "s1", cwd: "F:\\code\\token-larper", timestamp: at(3),
        message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 2, output_tokens: 10, cache_creation_input_tokens: 500, cache_read_input_tokens: 9000 } },
      },
      {
        type: "assistant", uuid: "a2", parentUuid: "a1", requestId: "r1", sessionId: "s1", timestamp: at(5),
        message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 2, output_tokens: 240, cache_creation_input_tokens: 500, cache_read_input_tokens: 9000 } },
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe(out[1]!.id);
    expect(out[1]).toEqual({
      id: "claude:m1:r1",
      harness: "claude",
      model: "claude-opus-5-5",
      start: T0,
      at: T0 + 5000,
      session: "s1",
      project: "token-larper",
      inputTokens: 2,
      outputTokens: 240,
      cacheCreationTokens: 500,
      cacheReadTokens: 9000,
    });
  });

  test("skips synthetic and API error messages and half-written lines", () => {
    const p = claudeParser();
    const out = feedAll(p, [
      { type: "assistant", uuid: "a1", timestamp: at(1), message: { id: "m1", model: "<synthetic>", usage: {} } },
      { type: "assistant", uuid: "a2", timestamp: at(2), isApiErrorMessage: true, message: { id: "m2", model: "claude-opus-5-5", usage: {} } },
      '{"type":"assistant","uuid":"a3","timest',
    ]);
    expect(out).toEqual([]);
  });

  test("keeps state across chunks, so a parent read earlier still times the response", () => {
    const p = claudeParser();
    p.feed(JSON.stringify({ type: "user", uuid: "u1", timestamp: at(0) }));
    const [e] = p.feed(JSON.stringify({ type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: at(2), message: { id: "m1", model: "claude-haiku-4-5", usage: { output_tokens: 30 } } }));
    expect(e!.start).toBe(T0);
  });
});

describe("codexParser", () => {
  const line = (o: object) => JSON.stringify(o);
  const meta = line({ timestamp: at(0), type: "session_meta", payload: { id: "abc", cwd: "/home/me/app" } });
  const turn = line({ timestamp: at(0), type: "turn_context", payload: { model: "gpt-5.5-codex", cwd: "/home/me/app" } });
  const prompt = line({ timestamp: at(1), type: "response_item", payload: { type: "message", role: "user" } });
  const reply = (s: number) => line({ timestamp: at(s), type: "response_item", payload: { type: "message", role: "assistant" } });
  const count = (s: number, total: number, usage: object) =>
    line({ timestamp: at(s), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: total }, last_token_usage: usage } } });

  test("splits cached input out of input, from token_count", () => {
    const out = feedAll(codexParser("2026/10/08/rollout-1"), [
      meta, turn, prompt, reply(4), reply(6),
      count(7, 1000, { input_tokens: 900, cached_input_tokens: 600, output_tokens: 100 }),
      count(8, 1000, { input_tokens: 900, cached_input_tokens: 600, output_tokens: 100 }),
    ]);
    expect(out).toEqual([{
      id: "codex:2026/10/08/rollout-1:1",
      harness: "codex",
      model: "gpt-5.5-codex",
      start: T0 + 1000,
      at: T0 + 6000,
      session: "2026/10/08/rollout-1",
      project: "app",
      inputTokens: 300,
      outputTokens: 100,
      cacheCreationTokens: 0,
      cacheReadTokens: 600,
    }]);
  });

  test("prefers token_usage_record and ignores the token_count that follows it", () => {
    const out = feedAll(codexParser("s"), [
      meta, turn, prompt, reply(4),
      line({ timestamp: at(5), type: "token_usage_record", payload: { usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 20 } } }),
      count(6, 70, { input_tokens: 50, output_tokens: 20 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.at).toBe(T0 + 5000);
    expect(out[0]!.outputTokens).toBe(20);
  });

  test("names responses in order, so reading a file again gives the same ids", () => {
    const lines = [meta, turn, prompt, reply(2), count(3, 10, { output_tokens: 5 }), prompt, reply(5), count(6, 20, { output_tokens: 5 })];
    const ids = (p: LineParser) => feedAll(p, lines).map((e) => e.id);
    expect(ids(codexParser("s"))).toEqual(ids(codexParser("s")));
    expect(ids(codexParser("s"))).toEqual(["codex:s:1", "codex:s:2"]);
  });
});

test("piParser reads its own start time and cache counts", () => {
  const out = feedAll(piParser("sess"), [
    { type: "session", cwd: "/work/site" },
    { type: "message", id: "e1", timestamp: at(4), message: { role: "assistant", model: "kimi-k3", timestamp: T0 + 1000, usage: { input: 10, output: 40, cacheRead: 300, cacheWrite: 5 } } },
  ]);
  expect(out[0]).toMatchObject({ id: "pi:sess:e1", model: "[pi] kimi-k3", start: T0 + 1000, at: T0 + 4000, project: "site", cacheReadTokens: 300, cacheCreationTokens: 5 });
});

test("geminiParser starts a reply at the line before it and counts thinking as output", () => {
  const out = feedAll(geminiParser(), [
    { sessionId: "g1" },
    { id: "q", type: "user", timestamp: at(0) },
    { id: "r", type: "gemini", timestamp: at(3), model: "gemini-3.5-pro", tokens: { input: 1000, cached: 400, output: 50, thoughts: 25 } },
  ]);
  expect(out[0]).toMatchObject({ id: "gemini:g1:r", start: T0, at: T0 + 3000, inputTokens: 600, cacheReadTokens: 400, outputTokens: 75 });
});

test("copilotOtelParser reads chat spans only", () => {
  const out = feedAll(copilotOtelParser(), [
    { name: "execute_tool bash", attributes: { "gen_ai.operation.name": "execute_tool" }, startTime: [1, 0], endTime: [2, 0] },
    {
      name: "chat gpt-5.5",
      spanContext: { spanId: "sp1" },
      startTime: [T0 / 1000, 0],
      endTime: [T0 / 1000 + 2, 0],
      attributes: { "gen_ai.operation.name": "chat", "gen_ai.response.model": "gpt-5.5-1m", "gen_ai.usage.input_tokens": 800, "gen_ai.usage.cache_read.input_tokens": 500, "gen_ai.usage.output_tokens": 60 },
    },
  ]);
  expect(out).toEqual([{
    id: "copilot:sp1",
    harness: "copilot",
    model: "gpt-5.5",
    start: T0,
    at: T0 + 2000,
    inputTokens: 300,
    outputTokens: 60,
    cacheCreationTokens: 0,
    cacheReadTokens: 500,
  }]);
});

test("folderName handles both separators and trailing slashes", () => {
  expect(folderName("F:\\code\\app\\")).toBe("app");
  expect(folderName("/home/me/site")).toBe("site");
  expect(folderName(undefined)).toBeUndefined();
});
