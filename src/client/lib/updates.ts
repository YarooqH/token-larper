import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateStatus } from "../../types.ts";

export const RELEASES_URL = "https://github.com/YarooqH/token-larper/pulls?q=is%3Apr+is%3Amerged";
export const UPDATE_COMMAND = "bunx token-larper@latest";

export type UpdatePhase = "idle" | "updating" | "failed";

export interface Updates {
  status: UpdateStatus | null;
  checking: boolean;
  phase: UpdatePhase;
  error: string | null;
  check: (force?: boolean) => Promise<void>;
  update: () => Promise<void>;
}

async function readVersion(query: string): Promise<UpdateStatus> {
  const res = await fetch(`/api/version${query}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as UpdateStatus;
}

// The new version downloads, then replaces this server. Give a slow connection time.
const UPDATE_TIMEOUT_MS = 3 * 60 * 1000;

export function useUpdates(autoCheck: boolean): Updates {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const polling = useRef<number | null>(null);

  const check = useCallback(async (force = false) => {
    setChecking(true);
    setError(null);
    try {
      const next = await readVersion(`?check=1${force ? "&force=1" : ""}`);
      setStatus(next);
      if (next.error) setError(`Couldn't check for updates: ${next.error}`);
    } catch (e) {
      setError(`Couldn't check for updates: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setChecking(false);
    }
  }, []);

  // Without automatic checks, only the installed version is read; nothing leaves the machine.
  useEffect(() => {
    if (autoCheck) void check();
    else readVersion("").then(setStatus).catch(() => {});
  }, [autoCheck, check]);

  useEffect(() => () => {
    if (polling.current !== null) window.clearInterval(polling.current);
  }, []);

  const update = useCallback(async () => {
    const from = status?.current;
    setPhase("updating");
    setError(null);
    try {
      const res = await fetch("/api/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setPhase("failed");
      setError(e instanceof Error ? e.message : "Could not start the update");
      return;
    }

    // While the servers swap, requests fail; keep asking until a different version answers.
    const started = Date.now();
    polling.current = window.setInterval(async () => {
      if (Date.now() - started > UPDATE_TIMEOUT_MS) {
        window.clearInterval(polling.current!);
        polling.current = null;
        setPhase("failed");
        setError(`The update didn't finish. Run ${UPDATE_COMMAND} in a terminal to update.`);
        return;
      }
      try {
        const next = await readVersion("");
        if (next.current !== from) location.reload();
      } catch {
        // The old server has stopped and the new one isn't up yet.
      }
    }, 1500);
  }, [status?.current]);

  return { status, checking, phase, error, check, update };
}
