import { describe, expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsContent, SettingsPage } from "./SettingsPage.tsx";
import { DEFAULT_APPEARANCE } from "../themes.ts";
import type { Updates } from "../lib/updates.ts";
import type { StartupConfig } from "../../types.ts";

type ContentProps = ComponentProps<typeof SettingsContent>;

const noop = () => {};
const updates: Updates = { status: null, checking: false, phase: "idle", error: null, check: async () => {}, update: async () => {} };
const startup: StartupConfig = { enabled: false, openBrowserOnBoot: false, port: 4269, registryValue: null, launcherPath: "C:\launch.vbs" };

const props: Omit<ContentProps, "query" | "section"> = {
  startup,
  saving: false,
  themeMode: "dark" as const,
  followsSystemTheme: false,
  appearance: DEFAULT_APPEARANCE,
  importedTheme: null,
  showRanks: true,
  updates,
  checkUpdates: true,
  onCheckUpdatesChange: noop,
  screenshot: false,
  onScreenshotChange: noop,
  privacy: { status: { offline: false, locked: false }, saving: false, error: null },
  onOfflineChange: noop,
  priceStatus: undefined,
  onThemeModeChange: noop,
  onAppearanceChange: noop,
  onImportTheme: noop,
  onShowRanksChange: noop,
  onToggleStartup: noop,
  onRetry: noop,
};

const content = (query: string, section: "appearance" | "general" | "privacy" | "about" = "appearance", over: Partial<typeof props> = {}) =>
  renderToStaticMarkup(<SettingsContent query={query} section={section} {...props} {...over} />);

describe("settings page", () => {
  const page = (section: "appearance" | "general" | "privacy" | "about") =>
    renderToStaticMarkup(<SettingsPage {...props} section={section} onSectionChange={noop} startupError={null} onClose={noop} onQuit={noop} />);
  const html = page("appearance");

  test("is the page's main region, labelled Settings, with a way back to the dashboard", () => {
    expect(html).toMatch(/^<main[^>]*aria-labelledby="settings-title"/);
    expect(html).toContain('id="settings-title"');
    expect(html).toContain('aria-label="Back to dashboard"');
    expect(html).not.toContain('role="dialog"');
  });

  test("shows whichever section it is given", () => {
    expect(page("privacy")).toContain("Screenshot mode");
    expect(page("privacy")).not.toContain("theme-mode-label");
    expect(page("about")).toContain("Technical details");
    expect(page("general")).toContain("Show stats");
    expect(page("privacy")).toMatch(/aria-current="true"[^>]*>(?:<svg[^>]*>.*?<\/svg>)<span>Privacy</);
  });

  test("has a labelled search box and a nav that marks the open section", () => {
    expect(html).toContain('aria-label="Search settings"');
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toMatch(/aria-current="true"[^>]*>(?:<svg[^>]*>.*?<\/svg>)<span>Appearance</);
    expect(html).toContain("Quit app");
  });

  test("opens on the Appearance section only", () => {
    expect(html).toContain('id="theme-mode-label"');
    expect(html).not.toContain("Start with Windows");
    expect(html).not.toContain("Check for updates");
  });
});

describe("settings content", () => {
  test("browsing shows one section, with its title", () => {
    const general = content("", "general");
    expect(general).toContain("Show stats");
    expect(general).toContain("Start with Windows");
    expect(general).not.toContain("Check for updates");
    expect(general).toContain("sp-section-head");
  });

  test("the About section lists updates and technical details", () => {
    const about = content("", "about");
    expect(about).toContain("Check for updates");
    expect(about).toContain("Technical details");
    expect(about).toContain("http://127.0.0.1:4269");
    expect(about).not.toContain("Screenshot mode");
  });

  test("the Privacy section lists screenshot mode and every request the app can make", () => {
    const privacy = content("", "privacy");
    for (const text of ["Screenshot mode", "Offline mode", "Check for updates automatically", "Price list download", "registry.npmjs.org", "openrouter.ai"]) {
      expect(privacy).toContain(text);
    }
    expect(privacy).not.toContain("Start with Windows");
  });

  test("a search shows only the matching controls, across sections, under section names", () => {
    const html = content("login", "appearance");
    expect(html).toContain("Start with Windows");
    expect(html).toContain("Open dashboard at sign-in");
    expect(html).not.toContain("Show stats");
    expect(html).not.toContain("theme-settings");
    expect(html).toContain('class="sp-group-label">General<');
    expect(html).not.toContain("sp-section-head");
  });

  test("a search can match a single control inside a section", () => {
    const html = content("accent", "general");
    expect(html).toContain('id="theme-accent-label"');
    expect(html).not.toContain("theme-style-label");
    expect(html).not.toContain("theme-mode-label");
    expect(html).not.toContain("theme-import");
  });

  test("a search that matches nothing says so and suggests words to try", () => {
    const html = content("zzz", "appearance");
    expect(html).toContain("No settings match");
    expect(html).toContain("zzz");
    expect(html).toContain("Try");
  });

  test("a search for a network word finds the switches that stop requests", () => {
    const html = content("network", "appearance");
    expect(html).toContain("Offline mode");
    expect(html).toContain("Price list download");
    expect(html).not.toContain("Screenshot mode");
  });

  test("startup settings that can't load show a retry, not empty rows", () => {
    const html = content("startup", "general", { startup: null });
    expect(html).toContain("Startup settings are unavailable.");
    expect(html).toContain("Try again");
  });
});
