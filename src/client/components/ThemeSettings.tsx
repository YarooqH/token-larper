import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { importThemeCss, THEME_PRESETS, type ImportedTheme, type ThemeMode, type ThemePalette } from "../themes.ts";
import { SelectMenu, type SelectMenuOption } from "./SelectMenu.tsx";

interface Props {
  mode: ThemeMode;
  palette: ThemePalette;
  importedTheme: ImportedTheme | null;
  onModeChange: (mode: ThemeMode) => void;
  onPaletteChange: (palette: ThemePalette) => void;
  onImportTheme: (theme: ImportedTheme) => void;
}

const SAMPLE_THEME = `:root {
  --bg: #f7f8f6;
  --surface: #ffffff;
  --text: #1f2a23;
  --accent: #2f5a43;
  --accent-ink: #ffffff;
}

.dark {
  --bg: #141916;
  --surface: #1b221e;
  --text: #e8eee7;
  --accent: #9fcaa8;
  --accent-ink: #11261a;
}`;

export function ThemeSettings({ mode, palette, importedTheme, onModeChange, onPaletteChange, onImportTheme }: Props) {
  const [css, setCss] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function applyPastedTheme() {
    try {
      const imported = importThemeCss(css);
      onImportTheme(imported);
      setError(null);
      setMessage("Theme applied.");
    } catch (cause) {
      setMessage(null);
      setError(cause instanceof Error ? cause.message : "Could not read this theme CSS.");
    }
  }

  const paletteOptions: SelectMenuOption<ThemePalette>[] = THEME_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.name,
    description: preset.description,
    visual: <span className="palette-color" aria-hidden="true" style={{ backgroundColor: mode === "dark" ? preset.darkAccent : preset.accent }} />,
  }));
  if (importedTheme) {
    const colors = importedTheme[mode];
    paletteOptions.push({
      value: "custom",
      label: "Imported theme",
      description: "Your saved CSS colors",
      visual: <span className="palette-color" aria-hidden="true" style={{ backgroundColor: colors["--accent"] }} />,
    });
  }

  return (
    <section className="settings-section theme-settings" aria-labelledby="settings-appearance-heading">
      <div className="settings-section-heading">
        <h4 id="settings-appearance-heading">Appearance</h4>
        <span>{mode === "dark" ? "Dark mode" : "Light mode"}</span>
      </div>

      <div className="theme-mode-row">
        <span>Color mode</span>
        <div className="segmented" role="group" aria-label="Color mode">
          {(["light", "dark"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={mode === option} onClick={() => onModeChange(option)}>
              {option === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>

      <SelectMenu
        label="Color palette"
        value={palette}
        options={paletteOptions}
        onChange={onPaletteChange}
        className="palette-picker"
        showDescriptionInTrigger
      />

      <details className="theme-import">
        <summary>
          <span>Import a CSS theme</span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="theme-import-body">
          <p>
            Paste light and dark CSS variable blocks. Use Token Larper colors or shadcn-style variables; extra CSS is ignored.
          </p>
          <details className="theme-format">
            <summary>Show example CSS <ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="theme-format-body">
              <p>This example has the five required Token Larper colors in both modes.</p>
              <pre>{SAMPLE_THEME}</pre>
            </div>
          </details>
          <label htmlFor="theme-css-input">Theme CSS</label>
          <textarea
            id="theme-css-input"
            rows={7}
            value={css}
            onChange={(event) => {
              setCss(event.target.value);
              setError(null);
              setMessage(null);
            }}
            placeholder="Paste the light and dark CSS variable blocks here…"
            spellCheck={false}
          />
          {error && <p className="theme-import-feedback is-error" role="alert">{error}</p>}
          {message && <p className="theme-import-feedback" role="status">{message}</p>}
          <div className="theme-import-actions">
            <button className="btn btn-primary" type="button" disabled={!css.trim()} onClick={applyPastedTheme}>
              Apply theme
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
