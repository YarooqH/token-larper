import { useCallback, useEffect, useRef, useState } from "react";
import type { PrivacyStatus } from "../../types.ts";

export interface Privacy {
  /** Null until the server answers. */
  status: PrivacyStatus | null;
  saving: boolean;
  error: string | null;
  setOffline: (offline: boolean) => Promise<boolean>;
}

/** Offline mode lives on the server, because the server is what makes the requests. */
export function usePrivacy(): Privacy {
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/privacy")
      .then((res) => (res.ok ? (res.json() as Promise<PrivacyStatus>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((next) => alive && setStatus(next))
      .catch(() => alive && setError("Couldn't read the offline setting."));
    return () => {
      alive = false;
    };
  }, []);

  /** Resolves true once the server has the new value. */
  const setOffline = useCallback(async (offline: boolean) => {
    if (busy.current) return false;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offline }),
      });
      const body = (await res.json().catch(() => null)) as (PrivacyStatus & { error?: string }) | null;
      if (!res.ok || !body) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setStatus({ offline: body.offline, locked: body.locked });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change the offline setting.");
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, []);

  return { status, saving, error, setOffline };
}
