// What the settings panel lists and how its search finds it. Each entry is one thing a
// person might look for; the panel renders the real control for every entry that matches.

export type SettingsSectionId = "appearance" | "general" | "privacy" | "about";

export type SettingId =
  | "mode"
  | "style"
  | "base"
  | "accent"
  | "import"
  | "stats"
  | "autostart"
  | "browser"
  | "screenshot"
  | "offline"
  | "auto-check"
  | "price-list"
  | "updates"
  | "details";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  blurb: string;
}

export interface SettingEntry {
  id: SettingId;
  section: SettingsSectionId;
  label: string;
  /** Extra words people might type that the label doesn't contain. */
  keywords: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "appearance", label: "Appearance", blurb: "Color mode, style, and colors." },
  { id: "general", label: "General", blurb: "What the dashboard shows and how the app starts." },
  { id: "privacy", label: "Privacy", blurb: "What you share and what this app can reach." },
  { id: "about", label: "About", blurb: "Version, updates, and where this copy runs." },
];

export const SETTING_ENTRIES: readonly SettingEntry[] = [
  { id: "mode", section: "appearance", label: "Color mode", keywords: "light dark system theme night day" },
  { id: "style", section: "appearance", label: "Style", keywords: "theme grove terminal paper brutal soft mono font radius corners look" },
  { id: "base", section: "appearance", label: "Base color", keywords: "background surface border text palette tint" },
  { id: "accent", section: "appearance", label: "Accent color", keywords: "highlight buttons links palette picker" },
  { id: "import", section: "appearance", label: "Import a CSS theme", keywords: "tweakcn shadcn paste imported colors variables" },
  { id: "stats", section: "general", label: "Show stats", keywords: "rank streak hall of larp badges header tab" },
  { id: "autostart", section: "general", label: "Start with Windows", keywords: "startup boot login sign in launch autostart registry" },
  { id: "browser", section: "general", label: "Open dashboard at sign-in", keywords: "startup boot login browser launch" },
  { id: "screenshot", section: "privacy", label: "Screenshot mode", keywords: "hide names projects folders paths redact blur private share streaming demo recording" },
  { id: "offline", section: "privacy", label: "Offline mode", keywords: "network internet connection requests price list updates npm openrouter download airplane" },
  { id: "auto-check", section: "privacy", label: "Check for updates automatically", keywords: "update npm registry version network request" },
  { id: "price-list", section: "privacy", label: "Price list download", keywords: "openrouter prices models network request estimate cost daily" },
  { id: "updates", section: "about", label: "Check for updates", keywords: "version upgrade update now release npm latest" },
  { id: "details", section: "about", label: "Technical details", keywords: "port address launcher path registry dashboard url" },
];

/** The address of a section of the settings page, e.g. "#settings/privacy". */
export const settingsHash = (section: SettingsSectionId) => `#settings/${section}`;

/** The section a "#settings" or "#settings/privacy" address points at, or null for any other address. */
export function settingsSectionFromHash(hash: string): SettingsSectionId | null {
  const [page, section] = hash.replace(/^#/, "").split("/");
  if (page !== "settings") return null;
  return SETTINGS_SECTIONS.find((s) => s.id === section)?.id ?? "appearance";
}

const sectionLabel = new Map(SETTINGS_SECTIONS.map((s) => [s.id, s.label]));

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The entries whose label, keywords, or section name contain every word typed, in panel
 * order. An empty query matches everything. Matching is by prefix, so "col" finds "color".
 */
export function searchSettings(query: string): SettingEntry[] {
  const terms = words(query);
  if (!terms.length) return [...SETTING_ENTRIES];
  return SETTING_ENTRIES.filter((entry) => {
    const haystack = words(`${entry.label} ${entry.keywords} ${sectionLabel.get(entry.section)}`);
    return terms.every((term) => haystack.some((word) => word.startsWith(term)));
  });
}

/** The matching entries grouped by section, skipping sections with none. */
export function groupBySection(entries: readonly SettingEntry[]): { section: SettingsSection; ids: ReadonlySet<SettingId> }[] {
  return SETTINGS_SECTIONS.flatMap((section) => {
    const ids = new Set(entries.filter((e) => e.section === section.id).map((e) => e.id));
    return ids.size ? [{ section, ids }] : [];
  });
}
