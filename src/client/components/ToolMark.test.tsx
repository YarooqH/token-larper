import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolMark, hasToolMark } from "./ToolMark.tsx";

test("draws the marks Simple Icons has, named for screen readers", () => {
  for (const id of ["claude", "gemini", "copilot", "opencode"] as const) expect(hasToolMark(id)).toBe(true);
  const html = renderToStaticMarkup(<ToolMark harness="claude" name="Claude Code" size={16} />);
  expect(html).toContain('role="img" aria-label="Claude Code"');
  expect(html).toContain('width="16"');
  expect(html).toContain("<title>Claude Code</title>");
});

test("falls back to a lettered badge for tools without a mark", () => {
  expect(hasToolMark("codex")).toBe(false);
  expect(renderToStaticMarkup(<ToolMark harness="codex" name="Codex CLI" />)).toContain(">C</span>");
  expect(renderToStaticMarkup(<ToolMark harness="antigravity" name="Antigravity" />)).toContain(">A</span>");
  expect(renderToStaticMarkup(<ToolMark harness="pi" name="pi-agent" />)).toContain(">π</span>");
});

test("a decorative mark is hidden from screen readers", () => {
  const html = renderToStaticMarkup(<ToolMark harness="claude" name="Claude Code" decorative />);
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain("<title>");
});
