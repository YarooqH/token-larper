import React, { useState } from "react";
import { Check, ChevronDown, Pipette } from "./Icons.tsx";
import {
  ACCENT_PRESETS,
  BASE_PRESETS,
  importThemeCss,
  STYLE_PRESETS,
  type Appearance,
  type ImportedTheme,
  type ThemeMode,
} from "../themes.ts";

interface Props {
  mode: ThemeMode;
  followsSystem: boolean;
  appearance: Appearance;
  importedTheme: ImportedTheme | null;
  onModeChange: (mode: ThemeMode | "system") => void;
  onAppearanceChange: (appearance: Appearance) => void;
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

export function ThemeSettings({ mode, followsSystem, appearance, importedTheme, onModeChange, onAppearanceChange, onImportTheme }: Props) {
  const [css, setCss] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function applyPastedTheme() {
    try {
      onImportTheme(importThemeCss(css));
      setError(null);
      setMessage("Theme applied. Its colors now sit on top of the selected style.");
    } catch (cause) {
      setMessage(null);
      setError(cause instanceof Error ? cause.message : "Could not read this theme CSS.");
    }
  }

  const modeValue = followsSystem ? "system" : mode;

  return (
    <section className="settings-section theme-settings" aria-labelledby="settings-appearance-heading">
      <div className="settings-section-heading">
        <h4 id="settings-appearance-heading">Appearance</h4>
      </div>

      <div className="theme-row">
        <span className="theme-row-label" id="theme-mode-label">Mode</span>
        <div className="segmented" role="group" aria-labelledby="theme-mode-label">
          {(["system", "light", "dark"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={modeValue === option} onClick={() => onModeChange(option)}>
              {option === "system" ? "System" : option === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-block">
        <span className="theme-row-label" id="theme-style-label">Style</span>
        <div className="style-grid" role="radiogroup" aria-labelledby="theme-style-label">
          {STYLE_PRESETS.map((style) => {
            const selected = appearance.style === style.id;
            return (
              <button
                key={style.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className="style-card"
                onClick={() => onAppearanceChange({ ...appearance, style: style.id })}
              >
                {/* The preview renders with the style's own tokens, so it shows fonts, radius, borders and colors. */}
                <span className="style-preview" data-style={style.id} aria-hidden="true">
                  <span className="sp-panel">
                    <span className="sp-title">Aa</span>
                    <span className="sp-bars">
                      <i style={{ height: "45%" }} />
                      <i style={{ height: "80%" }} />
                      <i style={{ height: "60%" }} />
                    </span>
                    <span className="sp-button" />
                  </span>
                </span>
                <span className="style-card-text">
                  <strong>{style.name}</strong>
                  <span>{style.description}</span>
                </span>
                {selected && <Check size={14} className="style-card-check" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <ColorChoices
        id="theme-base"
        label="Base"
        hint={appearance.imported ? "Set by your imported colors" : "Backgrounds, borders and text"}
        disabled={appearance.imported}
        choice={appearance.base}
        presets={BASE_PRESETS}
        fallbackCustom="#5f7390"
        onChange={(base) => onAppearanceChange({ ...appearance, base })}
      />

      <ColorChoices
        id="theme-accent"
        label="Accent"
        hint="Buttons, links and highlights"
        choice={appearance.accent}
        presets={ACCENT_PRESETS.map((preset) => ({ ...preset, color: mode === "dark" ? preset.dark : preset.light }))}
        fallbackCustom="#6d5bd0"
        onChange={(accent) => onAppearanceChange({ ...appearance, accent })}
      />

      {importedTheme && (
        <div className="theme-row">
          <span className="theme-row-label" id="theme-imported-label">Imported colors</span>
          <button
            type="button"
            role="switch"
            aria-checked={appearance.imported}
            aria-labelledby="theme-imported-label"
            className={`toggle ${appearance.imported ? "on" : ""}`}
            onClick={() => onAppearanceChange({ ...appearance, imported: !appearance.imported })}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      )}

      <details className="theme-import">
        <summary>
          <span>Import a CSS theme</span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="theme-import-body">
          <p>
            Paste light and dark CSS variable blocks, for example from tweakcn. Use Token Larper colors or
            shadcn-style variables; the colors apply on top of the selected style, and extra CSS is ignored.
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

type ColorChoice<Id extends string> = { kind: "style" } | { kind: "preset"; id: Id } | { kind: "custom"; color: string };

/** "Style default", a row of preset swatches, and a picker for any color. */
function ColorChoices<Id extends string>({ id, label, hint, disabled = false, choice, presets, fallbackCustom, onChange }: {
  id: string;
  label: string;
  hint: string;
  disabled?: boolean;
  choice: ColorChoice<Id>;
  presets: { id: Id; name: string; color: string }[];
  fallbackCustom: string;
  onChange: (choice: ColorChoice<Id>) => void;
}) {
  const labelId = `${id}-label`;
  return (
    <div className="theme-block">
      <div className="theme-block-heading">
        <span className="theme-row-label" id={labelId}>{label}</span>
        <span className="theme-row-hint">{hint}</span>
      </div>
      <div className="accent-row" role="radiogroup" aria-labelledby={labelId} aria-disabled={disabled || undefined}>
        <button
          type="button"
          role="radio"
          aria-checked={choice.kind === "style"}
          className="accent-default"
          disabled={disabled}
          onClick={() => onChange({ kind: "style" })}
        >
          Style default
        </button>
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={choice.kind === "preset" && choice.id === preset.id}
            aria-label={preset.name}
            title={preset.name}
            className="accent-swatch"
            disabled={disabled}
            style={{ background: preset.color }}
            onClick={() => onChange({ kind: "preset", id: preset.id })}
          />
        ))}
        <label
          className={`accent-custom ${choice.kind === "custom" ? "is-selected" : ""}`}
          style={choice.kind === "custom" ? { background: choice.color } : undefined}
          title="Pick any color"
        >
          <Pipette size={14} aria-hidden="true" />
          <span className="sr-only">Custom {label.toLowerCase()} color</span>
          <input
            type="color"
            disabled={disabled}
            value={choice.kind === "custom" ? choice.color : fallbackCustom}
            onChange={(event) => onChange({ kind: "custom", color: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
