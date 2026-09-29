import { expect, test } from "bun:test";
import { BASE_PRESETS, DEFAULT_APPEARANCE, resolveThemeVars, type StyleNeutrals } from "./themes.ts";

// Grove's neutrals and Mono's pure black-and-white ones, as the page resolves them.
const GROVE: StyleNeutrals = {
  light: { "--bg": "#f7f8f6", "--surface": "#ffffff", "--surface-2": "#f2f5f1", "--surface-3": "#e8eee7", "--border": "#e1e6de", "--border-strong": "#c7d1c5", "--text": "#1f2a23", "--text-2": "#4b5950", "--text-3": "#5f6d64" },
  dark: { "--bg": "#141916", "--surface": "#1b221e", "--surface-2": "#222b25", "--surface-3": "#2b362f", "--border": "#2e3932", "--border-strong": "#45524a", "--text": "#e8eee7", "--text-2": "#b5c1b7", "--text-3": "#98a59b" },
};
const MONO: StyleNeutrals = {
  light: { "--bg": "#ffffff", "--surface": "#ffffff", "--surface-2": "#f4f4f4", "--surface-3": "#e8e8e8", "--border": "#e2e2e2", "--border-strong": "#c4c4c4", "--text": "#0a0a0a", "--text-2": "#404040", "--text-3": "#595959" },
  dark: { "--bg": "#000000", "--surface": "#0a0a0a", "--surface-2": "#161616", "--surface-3": "#222222", "--border": "#262626", "--border-strong": "#3d3d3d", "--text": "#fafafa", "--text-2": "#c4c4c4", "--text-3": "#a3a3a3" },
};

function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => v / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

test("the style's own base leaves its neutrals alone", () => {
  const vars = resolveThemeVars(DEFAULT_APPEARANCE, null, GROVE);
  expect(vars.light["--bg"]).toBeUndefined();
  expect(vars.dark["--text"]).toBeUndefined();
});

test("any base color keeps text readable in both modes", () => {
  const bases = [
    ...BASE_PRESETS.map((b) => ({ kind: "preset" as const, id: b.id })),
    ...["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#000000", "#ffffff"].map((color) => ({ kind: "custom" as const, color })),
  ];
  for (const neutrals of [GROVE, MONO]) {
    for (const base of bases) {
      const vars = resolveThemeVars({ ...DEFAULT_APPEARANCE, base }, null, neutrals);
      for (const mode of ["light", "dark"] as const) {
        const v = vars[mode];
        for (const [property, target] of [["--text", 7], ["--text-2", 4.5], ["--text-3", 4.5]] as const) {
          expect(Math.min(contrast(v[property]!, v["--bg"]!), contrast(v[property]!, v["--surface"]!))).toBeGreaterThanOrEqual(target);
        }
      }
    }
  }
});

test("a base color tints even pure white and pure black", () => {
  const vars = resolveThemeVars({ ...DEFAULT_APPEARANCE, base: { kind: "custom", color: "#3366ff" } }, null, MONO);
  expect(vars.light["--bg"]).not.toBe("#ffffff");
  expect(vars.dark["--bg"]).not.toBe("#000000");
});

test("imported colors win over a base color", () => {
  // Imported colors are validated with the browser's CSS.supports, which Bun lacks.
  (globalThis as { CSS?: unknown }).CSS ??= { supports: () => true };
  const imported = {
    light: { "--bg": "#fafafa", "--surface": "#ffffff", "--text": "#111111", "--accent": "#0055aa", "--accent-ink": "#ffffff" },
    dark: { "--bg": "#050505", "--surface": "#101010", "--text": "#eeeeee", "--accent": "#66aaff", "--accent-ink": "#000000" },
  };
  const vars = resolveThemeVars({ ...DEFAULT_APPEARANCE, base: { kind: "preset", id: "plum" }, imported: true }, imported, GROVE);
  expect(vars.light["--bg"]).toBe("#fafafa");
  expect(vars.light["--border"]).toBeUndefined();
});
