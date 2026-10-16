import React from "react";
import { RefreshCw } from "./Icons.tsx";
import { RELEASES_URL, UPDATE_COMMAND, type Updates } from "../lib/updates.ts";

interface Props {
  updates: Updates;
  /** Offline mode is on, so nothing can be checked or installed. */
  offline: boolean;
}

function describe({ status, checking, phase }: Updates): string {
  if (phase === "updating") return `Updating to ${status?.latest}…`;
  if (checking) return "Checking…";
  if (!status?.checkedAt) return "Not checked yet";
  if (status.updateAvailable) return `${status.latest} is available`;
  return "You're up to date";
}

export function UpdateSettings({ updates, offline }: Props) {
  const { status, checking, phase, error, check, update } = updates;
  const canUpdate = !offline && status?.updateAvailable && status.source === "npm" && phase !== "updating";

  return (
    <section className="settings-section" aria-labelledby="settings-updates-heading">
      <div className="settings-section-heading">
        <h4 id="settings-updates-heading">Updates</h4>
        <span>{status ? `Version ${status.current}` : ""}</span>
      </div>
      <div className="setting-row">
        <div className="setting-copy">
          <strong>{offline ? "Offline mode is on" : describe(updates)}</strong>
          <p>
            {offline ? "Turn it off in Privacy to check for updates." : error ? error : status?.source === "source"
              ? "This copy runs from a git checkout. Update it with git pull."
              : <>Updates install with <code>{UPDATE_COMMAND}</code>. <a href={RELEASES_URL} target="_blank" rel="noreferrer">What's new</a></>}
          </p>
        </div>
        {canUpdate ? (
          <button className="btn btn-primary" onClick={() => void update()}>Update now</button>
        ) : (
          <button className="btn" disabled={offline || checking || phase === "updating"} onClick={() => void check(true)}>
            <RefreshCw size={14} className={checking ? "spin" : ""} aria-hidden="true" />
            <span>Check for updates</span>
          </button>
        )}
      </div>
    </section>
  );
}
