import { compareVersions } from "../semver.ts";
import type { EntryState } from "./backend.ts";

/**
 * npx and bunx put every version in its own folder, so an entry made by an older version
 * keeps starting that version. Repoint an entry at this copy when it starts an older or
 * deleted one. Never touch an entry the user turned off in the OS's settings.
 */
export function shouldRepoint(o: {
  state: EntryState;
  isThisCopy: boolean;
  targetExists: boolean;
  targetVersion: string | null;
  appVersion: string;
}): boolean {
  if (!o.state.target || o.isThisCopy || o.state.disabledBySystem) return false;
  if (o.targetExists && o.targetVersion !== null && compareVersions(o.targetVersion, o.appVersion) >= 0) return false;
  return true;
}
