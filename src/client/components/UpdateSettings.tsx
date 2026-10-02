import React from "react";
import { RefreshCw } from "./Icons.tsx";
import { RELEASES_URL, UPDATE_COMMAND, type Updates } from "../lib/updates.ts";

interface Props {
  updates: Updates;
  autoCheck: boolean;
  onAutoCheckChange: (autoCheck: boolean) => void;
}

function describe({ status, checking, phase }: Updates): string {
  if (phase === "updating") return `Updating to ${status?.latest}…`;
  if (checking) return "Checking…";
  if (!status?.checkedAt) return "Not checked yet";
  if (status.updateAvailable) return `${status.latest} is available`;
  return "You're up to date";
}

export function UpdateSettings({ updates, autoCheck, onAutoCheckChange }: Props) {
  const { status, checking, phase, error, check, update } = updates;
  const canUpdate = status?.updateAvailable && status.source === "npm" && phase !== "updating";

  return (
    <section className="settings-section" aria-labelledby="settings-updates-heading">
      <div className="settings-section-heading">
        <h4 id="settings-updates-heading">Updates</h4>
        <span>{status ? `Version ${status.current}` : ""}</span>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <strong>{describe(updates)}</strong>
          <p>
            {error ? error : status?.source === "source"
              ? "This copy runs from a git checkout. Update it with git pull."
              : <>Updates install with <code>{UPDATE_COMMAND}</code>. <a href={RELEASES_URL} target="_blank" rel="noreferrer">What's new</a></>}
          </p>
        </div>
        {canUpdate ? (
          <button className="btn btn-primary" onClick={() => void update()}>Update now</button>
        ) : (
          <button className="btn" disabled={checking || phase === "updating"} onClick={() => void check(true)}>
            <RefreshCw size={14} className={checking ? "spin" : ""} aria-hidden="true" />
            <span>Check for updates</span>
          </button>
        )}
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <strong id="setting-autoupdate-label">Check automatically</strong>
          <p>Ask npm for the latest version when the dashboard opens. Nothing else is sent.</p>
        </div>
        <button
          type="button"
          className={`toggle ${autoCheck ? "on" : ""}`}
          role="switch"
          aria-labelledby="setting-autoupdate-label"
          aria-checked={autoCheck}
          onClick={() => onAutoCheckChange(!autoCheck)}
        >
          <span className="toggle-knob" />
        </button>
      </div>
    </section>
  );
}
