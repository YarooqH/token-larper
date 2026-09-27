export type ThemeMode = "light" | "dark";
export type ThemePalette = "pine" | "slate" | "ocean" | "iris" | "clay" | "rose" | "custom";

export interface ThemePreset {
  id: Exclude<ThemePalette, "custom">;
  name: string;
  description: string;
  accent: string;
  darkAccent: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "pine", name: "Pine", description: "The original forest green", accent: "#2f5a43", darkAccent: "#9fcaa8" },
  { id: "slate", name: "Slate", description: "Quiet blue gray", accent: "#495d75", darkAccent: "#9bb4d2" },
  { id: "ocean", name: "Ocean", description: "Cool blue and teal", accent: "#17627a", darkAccent: "#78c5d8" },
  { id: "iris", name: "Iris", description: "Soft violet", accent: "#68518f", darkAccent: "#c0a4ec" },
  { id: "clay", name: "Clay", description: "Warm terracotta", accent: "#995431", darkAccent: "#e1a177" },
  { id: "rose", name: "Rose", description: "Muted berry", accent: "#934f67", darkAccent: "#dfa1b4" },
];

export const THEME_MODE_STORAGE_KEY = "token-larper-theme";
export const THEME_PALETTE_STORAGE_KEY = "token-larper-palette";
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

export function isThemePalette(value: string | null): value is ThemePalette {
  return value === "custom" || THEME_PRESETS.some((preset) => preset.id === value);
}

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

export function readThemePalette(): ThemePalette {
  try {
    const stored = localStorage.getItem(THEME_PALETTE_STORAGE_KEY);
    if (!isThemePalette(stored)) return "pine";
    return stored === "custom" && !readImportedTheme() ? "pine" : stored;
  } catch {
    return "pine";
  }
}

export function applyTheme(mode: ThemeMode, palette: ThemePalette, importedTheme: ImportedTheme | null): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.palette = palette;
  for (const property of APP_COLOR_PROPERTIES) root.style.removeProperty(property);
  for (const property of APP_RADIUS_PROPERTIES) root.style.removeProperty(property);

  if (palette !== "custom" || !importedTheme) return;
  const tokens = importedTheme[mode];
  for (const property of APP_COLOR_PROPERTIES) {
    const value = tokens[property];
    if (validColor(value)) root.style.setProperty(property, value);
  }
  for (const property of APP_RADIUS_PROPERTIES) {
    if (validRadius(tokens[property])) root.style.setProperty(property, tokens[property]);
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
