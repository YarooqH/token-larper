import React from "react";
import type { StartupConfig } from "../../types.ts";
import type { SettingId } from "../lib/settingsIndex.ts";

interface Props {
  startup: StartupConfig | null;
  saving: boolean;
  showRanks: boolean;
  onShowRanksChange: (showRanks: boolean) => void;
  onToggleStartup: (enabled: boolean, openBrowserOnBoot?: boolean) => void;
  onRetry: () => void;
  /** Which of these settings to render; the panel passes the search matches. */
  show: (id: SettingId) => boolean;
}

export function GeneralSettings({ startup, saving, showRanks, onShowRanksChange, onToggleStartup, onRetry, show }: Props) {
  const showStartup = show("autostart") || show("browser");
  return (
    <>
      {show("stats") && (
        <section className="settings-section" aria-labelledby="settings-dashboard-heading">
          <div className="settings-section-heading">
            <h4 id="settings-dashboard-heading">Dashboard</h4>
          </div>
          <div className="setting-row">
            <div className="setting-copy">
              <strong id="setting-ranks-label">Show stats</strong>
              <p>Show the Stats tab and day streak in the header.</p>
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
      )}
      {showStartup && startup && (
        <section className="settings-section" aria-labelledby="settings-startup-heading">
          <div className="settings-section-heading">
            <h4 id="settings-startup-heading">Startup</h4>
            <span>{startup.enabled ? "Starts with Windows" : "Manual launch"}</span>
          </div>
          {show("autostart") && (
            <div className="setting-row">
              <div className="setting-copy">
                <strong id="setting-autostart-label">Start with Windows</strong>
                <p>Launch Token Larper when you sign in.</p>
              </div>
              <button
                disabled={saving}
                className={`toggle ${startup.enabled ? "on" : ""}`}
                role="switch"
                aria-labelledby="setting-autostart-label"
                aria-checked={startup.enabled}
                onClick={() => onToggleStartup(!startup.enabled)}
              >
                <span className="toggle-knob" />
              </button>
            </div>
          )}
          {show("browser") && (
            <div className="setting-row">
              <div className="setting-copy">
                <strong id="setting-browser-label">Open dashboard at sign-in</strong>
                <p>
                  {startup.enabled
                    ? "Open the dashboard in your browser after launch."
                    : "Takes effect when Start with Windows is on."}
                </p>
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
          )}
        </section>
      )}
      {showStartup && !startup && (
        <div className="settings-empty">
          <p>Startup settings are unavailable.</p>
          <button className="btn" onClick={onRetry}>Try again</button>
        </div>
      )}
    </>
  );
}
