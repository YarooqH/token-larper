import React, { useEffect, useRef } from "react";
import { ChevronDown, Power, X } from "./Icons.tsx";
import type { StartupConfig } from "../../types.ts";
import { ThemeSettings } from "./ThemeSettings.tsx";
import { UpdateSettings } from "./UpdateSettings.tsx";
import { startupCopy } from "../lib/startupCopy.ts";
import type { Updates } from "../lib/updates.ts";
import type { Appearance, ImportedTheme, ThemeMode } from "../themes.ts";

interface Props {
  startup: StartupConfig | null;
  startupError: string | null;
  saving: boolean;
  themeMode: ThemeMode;
  followsSystemTheme: boolean;
  appearance: Appearance;
  importedTheme: ImportedTheme | null;
  showRanks: boolean;
  updates: Updates;
  checkUpdates: boolean;
  onCheckUpdatesChange: (checkUpdates: boolean) => void;
  onClose: () => void;
  onThemeModeChange: (mode: ThemeMode | "system") => void;
  onAppearanceChange: (appearance: Appearance) => void;
  onImportTheme: (theme: ImportedTheme) => void;
  onShowRanksChange: (showRanks: boolean) => void;
  onToggleStartup: (enabled: boolean, openBrowserOnBoot?: boolean) => void;
  onRetry: () => void;
  onQuit: () => void;
}

export function SettingsDialog({
  startup,
  startupError,
  saving,
  themeMode,
  followsSystemTheme,
  appearance,
  importedTheme,
  showRanks,
  updates,
  checkUpdates,
  onCheckUpdatesChange,
  onClose,
  onThemeModeChange,
  onAppearanceChange,
  onImportTheme,
  onShowRanksChange,
  onToggleStartup,
  onRetry,
  onQuit,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), summary, textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]"
        ) ?? []
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => {
      window.removeEventListener("keydown", handleKeys);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h3 id="settings-title">Settings</h3>
            <p>Appearance, dashboard, startup, and updates</p>
          </div>
          <button ref={closeRef} className="icon-btn" aria-label="Close settings" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="modal-body">
          {startupError && <div className="inline-error" role="alert">{startupError}</div>}
          <ThemeSettings
            mode={themeMode}
            followsSystem={followsSystemTheme}
            appearance={appearance}
            importedTheme={importedTheme}
            onModeChange={onThemeModeChange}
            onAppearanceChange={onAppearanceChange}
            onImportTheme={onImportTheme}
          />
          <section className="settings-section" aria-labelledby="settings-dashboard-heading">
            <div className="settings-section-heading">
              <h4 id="settings-dashboard-heading">Dashboard</h4>
            </div>
            <div className="setting-row">
              <div className="setting-copy">
                <strong id="setting-ranks-label">Show ranks</strong>
                <p>Show the Rank tab and level label in the header.</p>
              </div>
              <button
                type="button"
                className={`toggle ${showRanks ? "on" : ""}`}
                role="switch"
                aria-labelledby="setting-ranks-label"
                aria-checked={showRanks}
                onClick={() => onShowRanksChange(!showRanks)}
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </section>
          {startup ? (() => {
            const copy = startupCopy(startup);
            return (
              <section className="settings-section" aria-labelledby="settings-startup-heading">
                <div className="settings-section-heading">
                  <h4 id="settings-startup-heading">Startup</h4>
                  <span>{copy.status}</span>
                </div>
                <div className="setting-row">
                  <div className="setting-copy">
                    <strong id="setting-autostart-label">{copy.toggleLabel}</strong>
                    <p>{copy.toggleHint}</p>
                  </div>
                  <button
                    disabled={saving || copy.toggleDisabled}
                    className={`toggle ${startup.enabled ? "on" : ""}`}
                    role="switch"
                    aria-labelledby="setting-autostart-label"
                    aria-checked={startup.enabled}
                    onClick={() => onToggleStartup(!startup.enabled)}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
                <div className="setting-row">
                  <div className="setting-copy">
                    <strong id="setting-browser-label">Open dashboard at sign-in</strong>
                    <p>{copy.browserHint}</p>
                  </div>
                  <button
                    disabled={saving}
                    className={`toggle ${startup.openBrowserOnBoot ? "on" : ""}`}
                    role="switch"
                    aria-labelledby="setting-browser-label"
                    aria-checked={startup.openBrowserOnBoot}
                    onClick={() => onToggleStartup(startup.enabled, !startup.openBrowserOnBoot)}
                  >
                    <span className="toggle-knob" />
                  </button>
                </div>
              </section>
            );
          })() : (
            <div className="settings-empty">
              <p>Startup settings are unavailable.</p>
              <button className="btn" onClick={onRetry}>Try again</button>
            </div>
          )}
          <UpdateSettings updates={updates} autoCheck={checkUpdates} onAutoCheckChange={onCheckUpdatesChange} />
          {startup && (
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
                  <dt>{startupCopy(startup).entryLabel}</dt>
                  <dd><code>{startup.entry || "Not registered"}</code></dd>
                </div>
                {startup.platform !== "windows" && (
                  <div>
                    <dt>Entry file</dt>
                    <dd><code>{startup.entryPath}</code></dd>
                  </div>
                )}
                <div>
                  <dt>Launcher</dt>
                  <dd><code>{startup.launcherPath}</code></dd>
                </div>
              </dl>
            </details>
          )}
        </div>

        <footer className="settings-footer">
          <span>Token Larper runs on this computer.</span>
          <button className="settings-quit" onClick={onQuit}>
            <Power size={14} /> Quit app
          </button>
        </footer>
      </div>
    </div>
  );
}
