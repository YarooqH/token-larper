import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Info, Power, Search, Settings, Sparkles, X } from "./Icons.tsx";
import type { Icon } from "./Icons.tsx";
import type { StartupConfig } from "../../types.ts";
import { GeneralSettings } from "./GeneralSettings.tsx";
import { ThemeSettings } from "./ThemeSettings.tsx";
import { UpdateSettings } from "./UpdateSettings.tsx";
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
  onThemeModeChange: (mode: ThemeMode | "system") => void;
  onAppearanceChange: (appearance: Appearance) => void;
  onImportTheme: (theme: ImportedTheme) => void;
  onShowRanksChange: (showRanks: boolean) => void;
  onToggleStartup: (enabled: boolean, openBrowserOnBoot?: boolean) => void;
  onRetry: () => void;
}

interface Props extends ContentProps {
  startupError: string | null;
  /** Opened with the keyboard shortcut, so the cursor starts in the search box. */
  initialFocus?: "search";
  onClose: () => void;
  onQuit: () => void;
}

const SECTION_ICONS: Record<SettingsSectionId, Icon> = {
  appearance: Sparkles,
  general: Settings,
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
            {s.id === "about" && (
              <>
                {(show("updates") || show("auto-check")) && (
                  <UpdateSettings updates={p.updates} autoCheck={p.checkUpdates} onAutoCheckChange={p.onCheckUpdatesChange} show={show} />
                )}
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
 * A panel on the right edge, so the dashboard stays in view while a setting changes.
 * It doesn't dim or block the page on wide screens; on narrow ones it covers the page.
 */
export function SettingsPanel({ startupError, initialFocus, onClose, onQuit, ...content }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<SettingsSectionId>("appearance");
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    (initialFocus === "search" ? searchRef : closeRef).current?.focus();
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // The first Escape clears a search; the next one closes the panel.
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
      previousFocus?.focus();
    };
    // Focus moves once, when the panel opens.
  }, [onClose]);

  function showSection(id: SettingsSectionId) {
    setQuery("");
    setSection(id);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  const searching = query.trim() !== "";
  const matchCount = searching ? searchSettings(query).length : 0;

  return (
    <>
      <div className="settings-scrim" onClick={onClose} aria-hidden="true" />
      <div className="settings-panel" role="dialog" aria-modal="false" aria-labelledby="settings-title">
        <header className="sp-head">
          <div className="sp-head-row">
            <h2 id="settings-title">Settings</h2>
            <button ref={closeRef} className="icon-btn" aria-label="Close settings" title="Close (Esc)" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
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
              onChange={(event) => {
                setQuery(event.target.value);
                scrollRef.current?.scrollTo({ top: 0 });
              }}
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
          <div ref={scrollRef} className="sp-content">
            {startupError && <div className="inline-error" role="alert">{startupError}</div>}
            <p className="sr-only" role="status">
              {searching ? `${matchCount} ${matchCount === 1 ? "setting" : "settings"} found` : ""}
            </p>
            <SettingsContent query={query} section={section} {...content} />
          </div>
        </div>

        <footer className="settings-footer">
          <span>Token Larper runs on this computer.</span>
          <button className="settings-quit" onClick={onQuit}>
            <Power size={14} /> Quit app
          </button>
        </footer>
      </div>
    </>
  );
}
