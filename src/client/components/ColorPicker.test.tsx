import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ColorPicker } from "./ColorPicker.tsx";
import { ThemeSettings } from "./ThemeSettings.tsx";
import { DEFAULT_APPEARANCE } from "../themes.ts";

describe("color picker", () => {
  test("shows the current color with labelled hue, vibrance and lightness sliders", () => {
    const html = renderToStaticMarkup(<ColorPicker value="#6d5bd0" label="Accent" onChange={() => {}} />);
    expect(html).toContain('value="#6d5bd0"');
    for (const name of ["hue", "vibrance", "lightness"]) expect(html).toContain(`aria-label="Accent ${name}"`);
    expect(html).toContain("--picked:#6d5bd0");
  });

  test("reports text contrast only when asked to", () => {
    const withContrast = renderToStaticMarkup(<ColorPicker value="#ffffff" label="Accent" showContrast onChange={() => {}} />);
    expect(withContrast).toMatch(/\d+\.\d:1 · /);
    const without = renderToStaticMarkup(<ColorPicker value="#ffffff" label="Base" onChange={() => {}} />);
    expect(without).not.toContain(":1 ·");
  });

  test("the appearance settings no longer use the browser's own color input", () => {
    const html = renderToStaticMarkup(
      <ThemeSettings
        mode="dark"
        followsSystem={false}
        appearance={DEFAULT_APPEARANCE}
        importedTheme={null}
        onModeChange={() => {}}
        onAppearanceChange={() => {}}
        onImportTheme={() => {}}
      />
    );
    expect(html).not.toContain('type="color"');
    expect(html).toContain('aria-label="Custom accent color"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });
});
