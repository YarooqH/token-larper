import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { HarnessId } from "../../types.ts";
import { SeriesKey, ToolMark, hasToolMark, toolOfKey } from "./ToolMark.tsx";

test("draws a mark for every tool LobeHub's set covers, Codex and Antigravity included", () => {
  const marked: HarnessId[] = ["claude", "codex", "antigravity", "opencode", "gemini", "copilot", "amp", "goose", "kilo", "kimi", "qwen", "openclaw", "grok"];
  for (const id of marked) expect(hasToolMark(id)).toBe(true);
  const html = renderToStaticMarkup(<ToolMark harness="codex" name="Codex CLI" color="var(--series-2)" size={16} />);
  expect(html).toContain('role="img" aria-label="Codex CLI"');
  expect(html).toContain("<title>Codex CLI</title>");
  expect(html).toContain('style="color:var(--series-2)"');
  expect(html).toContain('width="16"');
});

test("falls back to a lettered badge in the tool's color for tools without a mark", () => {
  for (const id of ["pi", "droid", "codebuff", "hermes", "zcode"] as const) expect(hasToolMark(id)).toBe(false);
  const droid = renderToStaticMarkup(<ToolMark harness="droid" name="Droid" color="var(--series-5)" />);
  expect(droid).toContain(">D</span>");
  expect(droid).toContain("color:var(--series-5)");
  expect(renderToStaticMarkup(<ToolMark harness="pi" name="pi-agent" />)).toContain(">π</span>");
});

test("a decorative mark is hidden from screen readers", () => {
  const html = renderToStaticMarkup(<ToolMark harness="claude" name="Claude Code" decorative />);
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain("<title>");
});

test("chart series keys show the tool's mark, and a swatch for anything else", () => {
  expect(toolOfKey("claude")).toBe("claude");
  expect(toolOfKey("codex::gpt-5.5")).toBe("codex");
  expect(toolOfKey("cacheRead")).toBeNull();
  expect(toolOfKey("other")).toBeNull();
  expect(renderToStaticMarkup(<SeriesKey seriesKey="antigravity" color="red" name="Antigravity" />)).toContain('class="tool-mark"');
  expect(renderToStaticMarkup(<SeriesKey seriesKey="input" color="red" name="Input" />)).toContain('class="series-swatch"');
});
