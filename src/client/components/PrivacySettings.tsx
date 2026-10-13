import React from "react";
import type { PricingStatus } from "../../types.ts";
import type { Privacy } from "../lib/privacy.ts";
import type { SettingId } from "../lib/settingsIndex.ts";
import { priceListLine, updateCheckLine } from "../lib/networkStatus.ts";

interface Props {
  screenshot: boolean;
  onScreenshotChange: (screenshot: boolean) => void;
  privacy: Pick<Privacy, "status" | "saving" | "error">;
  onOfflineChange: (offline: boolean) => void;
  autoCheck: boolean;
  onAutoCheckChange: (autoCheck: boolean) => void;
  /** When npm was last asked for the latest version (ISO). */
  checkedAt: string | null | undefined;
  priceStatus: PricingStatus | undefined;
  show: (id: SettingId) => boolean;
}

function Switch({ labelId, on, disabled, onChange }: { labelId: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`toggle ${on ? "on" : ""}`}
      role="switch"
      aria-labelledby={labelId}
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

export function PrivacySettings({
  screenshot,
  onScreenshotChange,
  privacy,
  onOfflineChange,
  autoCheck,
  onAutoCheckChange,
  checkedAt,
  priceStatus,
  show,
}: Props) {
  const { status, saving, error } = privacy;
  const offline = status?.offline ?? false;
  const showNetwork = show("offline") || show("auto-check") || show("price-list");

  return (
    <>
      {show("screenshot") && (
        <section className="settings-section" aria-labelledby="settings-sharing-heading">
          <div className="settings-section-heading">
            <h4 id="settings-sharing-heading">Sharing</h4>
          </div>
          <div className="setting-row">
            <div className="setting-copy">
              <strong id="setting-screenshot-label">Screenshot mode</strong>
              <p>
                Replace project names and folders with Project A, Project B, and so on, so a screenshot or screen share
                doesn't show what you're building. Token counts and costs stay.
              </p>
            </div>
            <Switch labelId="setting-screenshot-label" on={screenshot} onChange={onScreenshotChange} />
          </div>
        </section>
      )}
      {showNetwork && (
        <section className="settings-section" aria-labelledby="settings-network-heading">
          <div className="settings-section-heading">
            <h4 id="settings-network-heading">Network</h4>
            <span>Nothing about your usage is sent</span>
          </div>
          {show("offline") && (
            <div className="setting-row">
              <div className="setting-copy">
                <strong id="setting-offline-label">Offline mode</strong>
                <p>
                  {status?.locked
                    ? "Set by TOKEN_LARPER_OFFLINE. Remove the variable and restart Token Larper to turn it off."
                    : "Don't contact npm or OpenRouter. Update checks stop, and cost estimates use the saved price list."}
                </p>
                {error && <p className="setting-error" role="alert">{error}</p>}
              </div>
              <Switch
                labelId="setting-offline-label"
                on={offline}
                disabled={!status || saving || status.locked}
                onChange={onOfflineChange}
              />
            </div>
          )}
          {show("auto-check") && (
            <div className="setting-row">
              <div className="setting-copy">
                <strong id="setting-autoupdate-label">Check for updates automatically</strong>
                <p>Asks registry.npmjs.org for the latest version number when the dashboard opens. Only the package name is sent.</p>
                <p className="setting-meta">{updateCheckLine({ offline, autoCheck, checkedAt })}</p>
              </div>
              <Switch labelId="setting-autoupdate-label" on={autoCheck} disabled={offline} onChange={onAutoCheckChange} />
            </div>
          )}
          {show("price-list") && (
            <div className="setting-row">
              <div className="setting-copy">
                <strong>Price list download</strong>
                <p>Downloads OpenRouter's public model prices from openrouter.ai once a day, for cost estimates. Nothing is sent but the request.</p>
                <p className="setting-meta">{priceListLine({ offline, status: priceStatus })}</p>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
