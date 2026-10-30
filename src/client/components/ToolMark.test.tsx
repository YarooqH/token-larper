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
  expect(html).toContain('width="16"');
});

test("draws logos in their brand colors, never the chart color", () => {
  const claude = renderToStaticMarkup(<ToolMark harness="claude" name="Claude Code" color="var(--series-1)" />);
  expect(claude).toContain('fill="#D97757"');
  expect(claude).not.toContain("--series-1");
  expect(renderToStaticMarkup(<ToolMark harness="amp" name="Amp" />)).toContain('fill="#F34E3F"');
  // One-color logos follow the text color instead.
  const opencode = renderToStaticMarkup(<ToolMark harness="opencode" name="OpenCode" color="var(--series-3)" />);
  expect(opencode).toContain('fill="currentColor"');
  expect(opencode).not.toContain("--series-3");
});

test("each copy of a gradient logo points at its own gradient", () => {
  const html = renderToStaticMarkup(
    <>
      <ToolMark harness="antigravity" name="Antigravity" />
      <ToolMark harness="antigravity" name="Antigravity" />
    </>
  );
  const ids = [...html.matchAll(/<mask[^>]* id="([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  for (const id of ids) expect(html).toContain(`url(#${id})`);
});

test("escapes the tool name in a color logo's title", () => {
  expect(renderToStaticMarkup(<ToolMark harness="claude" name="<b>&" />)).toContain("<title>&lt;b&gt;&amp;</title>");
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

test("chart series keys show a series swatch, plus the tool's mark for tools", () => {
  expect(toolOfKey("claude")).toBe("claude");
  expect(toolOfKey("codex::gpt-5.5")).toBe("codex");
  expect(toolOfKey("cacheRead")).toBeNull();
  expect(toolOfKey("other")).toBeNull();
  const tool = renderToStaticMarkup(<SeriesKey seriesKey="antigravity" color="red" name="Antigravity" />);
  expect(tool).toContain('class="series-swatch" style="background:red"');
  expect(tool).toContain('class="tool-mark"');
  const input = renderToStaticMarkup(<SeriesKey seriesKey="input" color="red" name="Input" />);
  expect(input).toContain('class="series-swatch"');
  expect(input).not.toContain("tool-mark");
  // A lettered badge already wears the series color, so it needs no swatch.
  const droid = renderToStaticMarkup(<SeriesKey seriesKey="droid" color="red" name="Droid" />);
  expect(droid).toContain("color:red");
  expect(droid).not.toContain("series-swatch");
});
