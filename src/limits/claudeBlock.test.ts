import { describe, expect, test } from "bun:test";
import { computeClaudeBlock, parseClaudeLogLine, type ClaudeLogEntry } from "./claudeBlock.ts";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const hour = 3600_000;
const at = (hoursAgo: number, id: string, tokens = 100): ClaudeLogEntry => ({ id, tsMs: NOW - hoursAgo * hour, tokens });

describe("computeClaudeBlock", () => {
  test("the session starts at the first message and lasts five hours", () => {
    const block = computeClaudeBlock([at(3, "a"), at(2, "b"), at(0.5, "c")], NOW);
    expect(block?.startsAt).toBe(new Date(NOW - 3 * hour).toISOString());
    expect(block?.endsAt).toBe(new Date(NOW + 2 * hour).toISOString());
    expect(block?.messages).toBe(3);
    expect(block?.tokens).toBe(300);
  });

  test("a message after the window ends starts a new session", () => {
    const block = computeClaudeBlock([at(9, "old1"), at(8, "old2"), at(1, "new")], NOW);
    expect(block?.startsAt).toBe(new Date(NOW - hour).toISOString());
    expect(block?.messages).toBe(1);
  });

  test("returns null when the last session already ended", () => {
    expect(computeClaudeBlock([at(7, "a"), at(6, "b")], NOW)).toBeNull();
    expect(computeClaudeBlock([], NOW)).toBeNull();
  });

  test("streamed lines of one response count once, keeping the largest token count", () => {
    const block = computeClaudeBlock([at(1, "m1", 10), at(1, "m1", 250), at(0.5, "m2", 5)], NOW);
    expect(block?.messages).toBe(2);
    expect(block?.tokens).toBe(255);
  });

  test("ignores entries from the future and entries with bad times", () => {
    const block = computeClaudeBlock([at(-1, "future"), { id: "bad", tsMs: Number.NaN, tokens: 1 }, at(1, "ok")], NOW);
    expect(block?.messages).toBe(1);
  });
});

describe("parseClaudeLogLine", () => {
  const line = (extra: object) =>
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-14T11:00:00.000Z",
      message: { id: "msg_1", usage: { input_tokens: 2, output_tokens: 213, cache_creation_input_tokens: 20081, cache_read_input_tokens: 42312 } },
      ...extra,
    });

  test("counts input, output and cache-write tokens but not cache reads", () => {
    const entry = parseClaudeLogLine(line({}));
    expect(entry?.id).toBe("msg_1");
    expect(entry?.tokens).toBe(2 + 213 + 20081);
    expect(entry?.tsMs).toBe(Date.parse("2026-10-14T11:00:00.000Z"));
  });

  test("skips user lines, lines without usage, and broken JSON", () => {
    expect(parseClaudeLogLine(line({ type: "user" }))).toBeNull();
    expect(parseClaudeLogLine('{"type":"assistant","timestamp":"2026-10-14T11:00:00Z"}')).toBeNull();
    expect(parseClaudeLogLine('{"type":"assistant","usage": nope')).toBeNull();
  });
});
