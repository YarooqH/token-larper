export type ThemeMode = "light" | "dark";

// A theme is two independent choices. The style is the whole look and feel: fonts,
// radius, spacing, borders, shadows, label casing, and its own light and dark colors
// (all defined in styles.css under html[data-style]). The accent is either the style's
// own, one of the preset colors below, or any color the user picks. An imported CSS
// theme can replace the colors of whichever style is active.

export type StyleId = "grove" | "terminal" | "paper" | "brutal" | "soft" | "mono";

export interface StylePreset {
  id: StyleId;
  name: string;
  description: string;
  /** Swatches for the picker preview: [background, surface, text, accent] per mode. */
  light: [string, string, string, string];
  dark: [string, string, string, string];
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: "grove", name: "Grove", description: "Calm and roomy, the original look", light: ["#f7f8f6", "#ffffff", "#1f2a23", "#2f5a43"], dark: ["#141916", "#1b221e", "#e8eee7", "#9fcaa8"] },
  { id: "terminal", name: "Terminal", description: "Monospace, square, and dense", light: ["#f4f6f1", "#fbfcf8", "#121a13", "#146c36"], dark: ["#0b0f0c", "#0f1511", "#c8f7d0", "#5cf08a"] },
  { id: "paper", name: "Paper", description: "Serif headings on warm paper", light: ["#f5efe3", "#fbf7ee", "#2a2118", "#8c2f2b"], dark: ["#1b1712", "#221d17", "#f1e8da", "#e0907f"] },
  { id: "brutal", name: "Brutal", description: "Thick outlines and hard shadows", light: ["#fff8e7", "#ffffff", "#111111", "#d81b60"], dark: ["#121212", "#1c1c1c", "#f5f5f5", "#ff79b0"] },
  { id: "soft", name: "Soft", description: "Rounded, borderless, and airy", light: ["#f4f2fb", "#ffffff", "#26213a", "#6d5bd0"], dark: ["#16141f", "#1f1c2b", "#efecf8", "#b3a6ff"] },
  { id: "mono", name: "Mono", description: "Black and white, flips with the mode", light: ["#ffffff", "#ffffff", "#0a0a0a", "#0a0a0a"], dark: ["#000000", "#0a0a0a", "#fafafa", "#fafafa"] },
];

export type AccentId = "pine" | "slate" | "ocean" | "iris" | "clay" | "rose";

export const ACCENT_PRESETS: { id: AccentId; name: string; light: string; dark: string }[] = [
  { id: "pine", name: "Pine", light: "#2f5a43", dark: "#9fcaa8" },
  { id: "slate", name: "Slate", light: "#495d75", dark: "#9bb4d2" },
  { id: "ocean", name: "Ocean", light: "#17627a", dark: "#78c5d8" },
  { id: "iris", name: "Iris", light: "#68518f", dark: "#c0a4ec" },
  { id: "clay", name: "Clay", light: "#995431", dark: "#e1a177" },
  { id: "rose", name: "Rose", light: "#934f67", dark: "#dfa1b4" },
];

export type AccentChoice = { kind: "style" } | { kind: "preset"; id: AccentId } | { kind: "custom"; color: string };

export interface Appearance {
  style: StyleId;
  accent: AccentChoice;
  /** Use the imported CSS theme's colors on top of the style. */
  imported: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = { style: "grove", accent: { kind: "style" }, imported: false };

export const THEME_MODE_STORAGE_KEY = "token-larper-theme";
export const APPEARANCE_STORAGE_KEY = "token-larper-appearance";
/** Resolved inline variables for both modes; index.html applies them before first paint. */
export const THEME_VARS_STORAGE_KEY = "token-larper-theme-vars";
/** Earlier versions stored a color palette here; read once to migrate. */
const LEGACY_PALETTE_STORAGE_KEY = "token-larper-palette";
export const IMPORTED_THEME_STORAGE_KEY = "token-larper-imported-theme";

const APP_COLOR_PROPERTIES = [
  "--bg", "--surface", "--surface-2", "--surface-3", "--border", "--border-strong",
  "--text", "--text-2", "--text-3", "--accent", "--accent-ink", "--accent-soft", "--gold", "--focus",
  "--warning-bg", "--warning-border", "--warning-text", "--error-bg", "--error-border", "--error-text",
  "--series-1", "--series-2", "--series-3", "--series-4", "--series-5", "--series-6", "--series-7",
  "--series-other", "--heat-0", "--heat-1", "--heat-2", "--heat-3", "--heat-4",
] as const;
const APP_RADIUS_PROPERTIES = ["--radius", "--radius-sm"] as const;

export type AppColorProperty = (typeof APP_COLOR_PROPERTIES)[number];
export type AppRadiusProperty = (typeof APP_RADIUS_PROPERTIES)[number];
export type AppThemeTokens = Partial<Record<AppColorProperty | AppRadiusProperty, string>>;

export interface ImportedTheme {
  light: AppThemeTokens;
  dark: AppThemeTokens;
}

const REQUIRED_PROPERTIES: AppColorProperty[] = ["--bg", "--surface", "--text", "--accent", "--accent-ink"];

function validColor(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 180
    && !/[;{}]|\bvar\s*\(|url\s*\(/i.test(value)
    && CSS.supports("color", value);
}

function validRadius(value: unknown): value is string {
  return typeof value === "string" && /^\d+(?:\.\d+)?(?:px|rem|em)$/.test(value);
}

function sanitizeTokens(value: unknown): AppThemeTokens | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const tokens: AppThemeTokens = {};
  for (const property of APP_COLOR_PROPERTIES) {
    if (validColor(source[property])) tokens[property] = source[property];
  }
  for (const property of APP_RADIUS_PROPERTIES) {
    if (validRadius(source[property])) tokens[property] = source[property];
  }
  return REQUIRED_PROPERTIES.every((property) => tokens[property]) ? tokens : null;
}

export function sanitizeImportedTheme(value: unknown): ImportedTheme | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const light = sanitizeTokens(source.light);
  const dark = sanitizeTokens(source.dark);
  return light && dark ? { light, dark } : null;
}

export function readImportedTheme(): ImportedTheme | null {
  try {
    return sanitizeImportedTheme(JSON.parse(localStorage.getItem(IMPORTED_THEME_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

const isStyle = (value: unknown): value is StyleId => STYLE_PRESETS.some((s) => s.id === value);
const isAccentId = (value: unknown): value is AccentId => ACCENT_PRESETS.some((a) => a.id === value);
const isHex = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

function sanitizeAppearance(value: unknown): Appearance | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const a = (v.accent ?? {}) as Record<string, unknown>;
  const accent: AccentChoice =
    a.kind === "preset" && isAccentId(a.id)
      ? { kind: "preset", id: a.id }
      : a.kind === "custom" && isHex(a.color)
        ? { kind: "custom", color: a.color.toLowerCase() }
        : { kind: "style" };
  return { style: isStyle(v.style) ? v.style : "grove", accent, imported: v.imported === true };
}

export function readAppearance(): Appearance {
  try {
    const saved = sanitizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || "null"));
    if (saved) return saved.imported && !readImportedTheme() ? { ...saved, imported: false } : saved;
    // Migrate the old color-palette setting: its colors live on as the accent.
    const legacy = localStorage.getItem(LEGACY_PALETTE_STORAGE_KEY);
    if (legacy === "custom" && readImportedTheme()) return { ...DEFAULT_APPEARANCE, imported: true };
    if (isAccentId(legacy) && legacy !== "pine") return { ...DEFAULT_APPEARANCE, accent: { kind: "preset", id: legacy } };
  } catch {
    // Storage may be disabled.
  }
  return DEFAULT_APPEARANCE;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function mix(a: string, b: string, weightOfA: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i]! * weightOfA + y[i]! * (1 - weightOfA)) as [number, number, number]);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Whichever of white or near-black reads better on the accent (buttons, badges). */
function inkFor(accent: string): string {
  return contrast("#ffffff", accent) >= contrast("#101010", accent) ? "#ffffff" : "#101010";
}

/**
 * The accent colors links, tab underlines and focus rings, so a custom pick is darkened
 * (light mode) or lightened (dark mode) in small steps until it reads at 4.5:1 against
 * a typical background. Picks that already pass are used unchanged.
 */
function accentFor(choice: AccentChoice, mode: ThemeMode): string | null {
  if (choice.kind === "preset") {
    const preset = ACCENT_PRESETS.find((a) => a.id === choice.id)!;
    return mode === "dark" ? preset.dark : preset.light;
  }
  if (choice.kind === "custom") {
    const [background, toward] = mode === "light" ? ["#ffffff", "#000000"] : ["#161616", "#ffffff"];
    let color = choice.color;
    for (let step = 0; step < 12 && contrast(color, background) < 4.5; step++) color = mix(color, toward, 0.88);
    return color;
  }
  return null;
}

export type ThemeVars = Record<ThemeMode, Record<string, string>>;

/** Inline variables for an accent override or an imported theme, for both modes. */
export function resolveThemeVars(appearance: Appearance, importedTheme: ImportedTheme | null): ThemeVars {
  const vars: ThemeVars = { light: {}, dark: {} };
  for (const mode of ["light", "dark"] as const) {
    const out = vars[mode];
    if (appearance.imported && importedTheme) {
      const tokens = importedTheme[mode];
      for (const property of APP_COLOR_PROPERTIES) if (validColor(tokens[property])) out[property] = tokens[property]!;
      for (const property of APP_RADIUS_PROPERTIES) if (validRadius(tokens[property])) out[property] = tokens[property]!;
    }
    const accent = accentFor(appearance.accent, mode);
    if (accent) {
      out["--accent"] = accent;
      out["--focus"] = accent;
      out["--accent-ink"] = inkFor(accent);
      out["--accent-soft"] = `color-mix(in srgb, ${accent} ${mode === "dark" ? 18 : 12}%, var(--bg))`;
    }
  }
  return vars;
}

let appliedProperties: string[] = [];

export function applyTheme(mode: ThemeMode, appearance: Appearance, importedTheme: ImportedTheme | null): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.style = appearance.style;
  root.dataset.accent = appearance.accent.kind === "style" && !appearance.imported ? "style" : "custom";
  // Clear what an earlier call (or index.html) set before applying the new values.
  for (const property of new Set([...appliedProperties, ...APP_COLOR_PROPERTIES, ...APP_RADIUS_PROPERTIES])) {
    root.style.removeProperty(property);
  }
  const vars = resolveThemeVars(appearance, importedTheme);
  for (const [property, value] of Object.entries(vars[mode])) root.style.setProperty(property, value);
  appliedProperties = Object.keys(vars[mode]);
  try {
    localStorage.setItem(THEME_VARS_STORAGE_KEY, JSON.stringify(vars));
  } catch {
    // Storage may be disabled; the theme still applies for this page.
  }
}

export function saveAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Storage may be disabled.
  }
}

function parseColorBlocks(css: string): { light: Map<string, string>; dark: Map<string, string> } {
  if (css.length > 50_000) throw new Error("Theme CSS is too large. Keep it under 50 KB.");
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  const blocks = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = blocks.exec(cleaned))) {
    const selector = match[1]!.trim();
    const isDark = /\.dark\b|data-(?:theme|mode)\s*=\s*(?:["']dark["']|dark\b)/i.test(selector);
    const isLight = /:root\b|^html\b|data-(?:theme|mode)\s*=\s*(?:["']light["']|light\b)/i.test(selector);
    if (!isDark && !isLight) continue;

    const destination = isDark ? dark : light;
    for (const declaration of match[2]!.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1).trim().replace(/\s*!important\s*$/i, "");
      if (name.startsWith("--") && value) destination.set(name.slice(2), value);
    }
  }

  return { light, dark };
}

function colorValue(tokens: Map<string, string>, key: string, fallback?: string): string {
  const raw = tokens.get(key) ?? fallback;
  if (!raw) throw new Error(`The pasted CSS is missing --${key}.`);
  // Older shadcn exports store HSL channels without the hsl() wrapper.
  const value = /^-?\d+(?:\.\d+)?(?:deg|turn|rad)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%(?:\s*\/\s*\d+(?:\.\d+)?%?)?$/i.test(raw)
    ? `hsl(${raw})`
    : raw;
  if (!validColor(value)) throw new Error(`--${key} must be a CSS color such as oklch(...), hsl(...), rgb(...), or #hex.`);
  return value;
}

function mapShadcnTokens(source: Map<string, string>, fallback?: Map<string, string>): AppThemeTokens {
  const get = (key: string, appFallback?: string) => colorValue(source, key, appFallback);
  const background = get("background");
  const foreground = get("foreground");
  const primary = get("primary");
  const primaryForeground = get("primary-foreground");
  const mutedForeground = get("muted-foreground", foreground);
  const secondary = get("secondary", source.get("muted") ?? background);
  const muted = get("muted", secondary);
  const destructive = source.has("destructive") ? get("destructive") : "#a9342b";
  const tokens: AppThemeTokens = {
    "--bg": background,
    "--surface": get("card", source.get("popover") ?? background),
    "--surface-2": muted,
    "--surface-3": secondary,
    "--border": source.has("border") ? get("border") : `color-mix(in srgb, ${foreground} 14%, ${background})`,
    "--border-strong": source.has("input") ? get("input") : get("border", `color-mix(in srgb, ${foreground} 22%, ${background})`),
    "--text": foreground,
    "--text-2": mutedForeground,
    "--text-3": `color-mix(in srgb, ${mutedForeground} 78%, ${background})`,
    "--accent": primary,
    "--accent-ink": primaryForeground,
    "--accent-soft": source.has("accent") ? get("accent") : secondary,
    "--focus": source.has("ring") ? get("ring") : primary,
    "--error-bg": `color-mix(in srgb, ${background} 90%, ${destructive})`,
    "--error-border": destructive,
    "--error-text": destructive,
  };

  for (let index = 1; index <= 7; index++) {
    const key = `chart-${index}`;
    if (source.has(key)) tokens[`--series-${index}` as AppColorProperty] = get(key);
  }
  for (const property of APP_RADIUS_PROPERTIES) {
    const key = property.slice(2);
    const radius = source.get(key) ?? fallback?.get(key);
    if (validRadius(radius)) tokens[property] = radius;
  }
  return tokens;
}

function mapTokenLarperTokens(source: Map<string, string>, fallback?: Map<string, string>): AppThemeTokens {
  const background = colorValue(source, "bg");
  const surface = colorValue(source, "surface");
  const foreground = colorValue(source, "text");
  const accent = colorValue(source, "accent");
  const accentInk = colorValue(source, "accent-ink");
  const tokens: AppThemeTokens = {
    "--bg": background,
    "--surface": surface,
    "--surface-2": `color-mix(in srgb, ${surface} 94%, ${foreground})`,
    "--surface-3": `color-mix(in srgb, ${surface} 88%, ${foreground})`,
    "--border": `color-mix(in srgb, ${surface} 84%, ${foreground})`,
    "--border-strong": `color-mix(in srgb, ${surface} 72%, ${foreground})`,
    "--text": foreground,
    "--text-2": `color-mix(in srgb, ${foreground} 75%, ${background})`,
    "--text-3": `color-mix(in srgb, ${foreground} 70%, ${background})`,
    "--accent": accent,
    "--accent-ink": accentInk,
    "--accent-soft": `color-mix(in srgb, ${background} 86%, ${accent})`,
    "--focus": accent,
  };
  for (const property of APP_COLOR_PROPERTIES) {
    const key = property.slice(2);
    if (source.has(key)) tokens[property] = colorValue(source, key);
  }

  for (const property of APP_RADIUS_PROPERTIES) {
    const key = property.slice(2);
    const radius = source.get(key) ?? fallback?.get(key);
    if (validRadius(radius)) tokens[property] = radius;
  }
  return tokens;
}

const REQUIRED_SHADCN_PROPERTIES = ["background", "foreground", "primary", "primary-foreground"];
const REQUIRED_APP_PROPERTIES = REQUIRED_PROPERTIES.map((property) => property.slice(2));

export function importThemeCss(css: string): ImportedTheme {
  if (typeof css !== "string" || !css.trim()) {
    throw new Error("Paste CSS with light and dark color variable blocks.");
  }

  const blocks = parseColorBlocks(css);
  if (blocks.light.size === 0 || blocks.dark.size === 0) {
    throw new Error("Include a light :root block and a dark .dark or [data-theme=\"dark\"] block.");
  }

  const hasAppTokens = [blocks.light, blocks.dark].every((tokens) =>
    REQUIRED_APP_PROPERTIES.every((key) => tokens.has(key))
  );
  const hasShadcnTokens = [blocks.light, blocks.dark].every((tokens) =>
    REQUIRED_SHADCN_PROPERTIES.every((key) => tokens.has(key))
  );

  let light: AppThemeTokens;
  let dark: AppThemeTokens;
  if (hasAppTokens) {
    light = mapTokenLarperTokens(blocks.light);
    dark = mapTokenLarperTokens(blocks.dark, blocks.light);
  } else if (hasShadcnTokens) {
    light = mapShadcnTokens(blocks.light);
    dark = mapShadcnTokens(blocks.dark, blocks.light);
  } else {
    throw new Error(
      "Both light and dark blocks need --bg, --surface, --text, --accent, and --accent-ink. "
      + "shadcn-style --background, --foreground, --primary, and --primary-foreground are supported too."
    );
  }

  const sanitized = sanitizeImportedTheme({ light, dark });
  if (!sanitized) throw new Error("Some theme values are not valid CSS colors. Check the required tokens in both blocks.");
  return sanitized;
}
