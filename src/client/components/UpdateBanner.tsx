import React from "react";
import { ArrowUpCircle, RefreshCw, X } from "lucide-react";
import { RELEASES_URL, type Updates } from "../lib/updates.ts";

export function UpdateBanner({ updates, onDismiss }: { updates: Updates; onDismiss: () => void }) {
  const { status, phase, error, update } = updates;
  if (!status?.latest) return null;
  const updating = phase === "updating";

  return (
    <div className="update-banner" role="status">
      {updating ? <RefreshCw size={16} className="spin" aria-hidden="true" /> : <ArrowUpCircle size={16} aria-hidden="true" />}
      <p>
        {updating ? (
          <>Updating to {status.latest}. The dashboard reloads when it's ready.</>
        ) : phase === "failed" ? (
          <>{error}</>
        ) : (
          <>
            <strong>Token Larper {status.latest} is out.</strong>{" "}
            <span>
              {status.source === "source" ? "This copy runs from git; update it with git pull." : `You have ${status.current}.`}
            </span>
          </>
        )}
      </p>
      <div className="update-banner-actions">
        <a className="update-link" href={RELEASES_URL} target="_blank" rel="noreferrer">What's new</a>
        {status.source === "npm" && (
          <button className="btn btn-primary" disabled={updating} onClick={() => void update()}>
            {phase === "failed" ? "Try again" : updating ? "Updating…" : "Update now"}
          </button>
        )}
        {!updating && (
          <button className="icon-btn" aria-label={`Hide the ${status.latest} update`} title="Not now" onClick={onDismiss}>
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
