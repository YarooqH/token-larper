import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Info, Power, Search, Settings, Shield, Sparkles } from "./Icons.tsx";
import type { Icon } from "./Icons.tsx";
import type { PricingStatus, StartupConfig } from "../../types.ts";
import { GeneralSettings } from "./GeneralSettings.tsx";
import { PrivacySettings } from "./PrivacySettings.tsx";
import { ThemeSettings } from "./ThemeSettings.tsx";
import { UpdateSettings } from "./UpdateSettings.tsx";
import type { Privacy } from "../lib/privacy.ts";
import { isEditable } from "../lib/shortcuts.ts";
import {
  groupBySection,
  searchSettings,
  SETTING_ENTRIES,
  SETTINGS_SECTIONS,
  type SettingId,
  type SettingsSectionId,
} from "../lib/settingsIndex.ts";
import type { Updates } from "../lib/updates.ts";
import type { Appearance, ImportedTheme, ThemeMode } from "../themes.ts";

interface ContentProps {
  startup: StartupConfig | null;
  saving: boolean;
  themeMode: ThemeMode;
  followsSystemTheme: boolean;
  appearance: Appearance;
  importedTheme: ImportedTheme | null;
  showRanks: boolean;
  updates: Updates;
  checkUpdates: boolean;
  onCheckUpdatesChange: (checkUpdates: boolean) => void;
  screenshot: boolean;
  onScreenshotChange: (screenshot: boolean) => void;
  privacy: Pick<Privacy, "status" | "saving" | "error">;
  onOfflineChange: (offline: boolean) => void;
  priceStatus: PricingStatus | undefined;
  onThemeModeChange: (mode: ThemeMode | "system") => void;
  onAppearanceChange: (appearance: Appearance) => void;
  onImportTheme: (theme: ImportedTheme) => void;
  onShowRanksChange: (showRanks: boolean) => void;
  onToggleStartup: (enabled: boolean, openBrowserOnBoot?: boolean) => void;
  onRetry: () => void;
}

interface Props extends ContentProps {
  startupError: string | null;
  /** The section on show while not searching. */
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  /** Opened with the keyboard shortcut, so the cursor starts in the search box. */
  initialFocus?: "search";
  onClose: () => void;
  onQuit: () => void;
}

const SECTION_ICONS: Record<SettingsSectionId, Icon> = {
  appearance: Sparkles,
  general: Settings,
  privacy: Shield,
  about: Info,
};

function TechnicalDetails({ startup }: { startup: StartupConfig }) {
  return (
    <details className="settings-details">
      <summary>
        Technical details <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <dl>
        <div>
          <dt>Dashboard</dt>
          <dd><code>http://127.0.0.1:{startup.port}</code></dd>
        </div>
        <div>
          <dt>Windows startup</dt>
          <dd><code>{startup.registryValue || "Not registered"}</code></dd>
        </div>
        <div>
          <dt>Launcher</dt>
          <dd><code>{startup.launcherPath}</code></dd>
        </div>
      </dl>
    </details>
  );
}

/**
 * The settings on show: one section while browsing, or every setting that matches the
 * search, each under its section's name. Matches are the real controls, so they work in place.
 */
export function SettingsContent({ query, section, ...p }: ContentProps & { query: string; section: SettingsSectionId }) {
  const searching = query.trim() !== "";
  const groups = groupBySection(searching ? searchSettings(query) : SETTING_ENTRIES.filter((e) => e.section === section));

  if (searching && !groups.length) {
    return (
      <div className="sp-empty">
        <strong>No settings match “{query.trim()}”</strong>
        <p>Try “theme”, “startup”, or “update”.</p>
      </div>
    );
  }

  return (
    <>
      {groups.map(({ section: s, ids }) => {
        const show = (id: SettingId) => ids.has(id);
        return (
          <div key={s.id} className="sp-group">
            {searching ? (
              <h3 className="sp-group-label">{s.label}</h3>
            ) : (
              <header className="sp-section-head">
                <h3>{s.label}</h3>
                <p>{s.blurb}</p>
              </header>
            )}
            {s.id === "appearance" && (
              <ThemeSettings
                mode={p.themeMode}
                followsSystem={p.followsSystemTheme}
                appearance={p.appearance}
                importedTheme={p.importedTheme}
                onModeChange={p.onThemeModeChange}
                onAppearanceChange={p.onAppearanceChange}
                onImportTheme={p.onImportTheme}
                show={show}
              />
            )}
            {s.id === "general" && (
              <GeneralSettings
                startup={p.startup}
                saving={p.saving}
                showRanks={p.showRanks}
                onShowRanksChange={p.onShowRanksChange}
                onToggleStartup={p.onToggleStartup}
                onRetry={p.onRetry}
                show={show}
              />
            )}
            {s.id === "privacy" && (
              <PrivacySettings
                screenshot={p.screenshot}
                onScreenshotChange={p.onScreenshotChange}
                privacy={p.privacy}
                onOfflineChange={p.onOfflineChange}
                autoCheck={p.checkUpdates}
                onAutoCheckChange={p.onCheckUpdatesChange}
                checkedAt={p.updates.status?.checkedAt}
                priceStatus={p.priceStatus}
                show={show}
              />
            )}
            {s.id === "about" && (
              <>
                {show("updates") && <UpdateSettings updates={p.updates} offline={p.privacy.status?.offline ?? false} />}
                {show("details") && p.startup && <TechnicalDetails startup={p.startup} />}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Settings as a page of their own, reached from the gear or with the "," key. The section
 * is part of the address (#settings/privacy), so a section can be linked to.
 */
export function SettingsPage({ startupError, section, onSectionChange, initialFocus, onClose, onQuit, ...content }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    (initialFocus === "search" ? searchRef : titleRef).current?.focus({ preventScroll: true });
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // The first Escape clears a search; the next one leaves settings.
        if (queryRef.current) {
          setQuery("");
          searchRef.current?.focus();
        } else {
          onClose();
        }
        return;
      }
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditable(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => {
      window.removeEventListener("keydown", handleKeys);
      previousFocus?.focus({ preventScroll: true });
    };
    // Focus moves once, when the page opens.
  }, [onClose]);

  function showSection(id: SettingsSectionId) {
    setQuery("");
    onSectionChange(id);
    window.scrollTo(0, 0);
  }

  const searching = query.trim() !== "";
  const matchCount = searching ? searchSettings(query).length : 0;

  return (
    <main className="settings-page" aria-labelledby="settings-title">
      <header className="sp-head">
        <button type="button" className="btn sp-back" aria-label="Back to dashboard" title="Back to the dashboard (Esc)" onClick={onClose}>
          <ChevronLeft size={15} aria-hidden="true" />
          <span>Dashboard</span>
        </button>
        <h2 id="settings-title" ref={titleRef} tabIndex={-1}>Settings</h2>
        <label className="search sp-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search settings"
            aria-label="Search settings"
            aria-keyshortcuts="/"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          {!query && <kbd aria-hidden="true">/</kbd>}
        </label>
      </header>

      <div className="sp-body">
        <nav className="sp-nav" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((s) => {
            const SectionIcon = SECTION_ICONS[s.id];
            const active = !searching && section === s.id;
            return (
              <button key={s.id} type="button" aria-current={active ? "true" : undefined} onClick={() => showSection(s.id)}>
                <SectionIcon size={15} aria-hidden="true" />
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sp-content">
          {startupError && <div className="inline-error" role="alert">{startupError}</div>}
          <p className="sr-only" role="status">
            {searching ? `${matchCount} ${matchCount === 1 ? "setting" : "settings"} found` : ""}
          </p>
          <SettingsContent query={query} section={section} {...content} />
        </div>
      </div>

      <footer className="sp-foot">
        <span>Token Larper runs on this computer.</span>
        <button type="button" className="settings-quit" onClick={onQuit}>
          <Power size={14} aria-hidden="true" /> Quit app
        </button>
      </footer>
    </main>
  );
}
