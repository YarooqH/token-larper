import type { DashboardPayload, SessionEntry } from "../../types.ts";

// Screenshot mode swaps what identifies the person's work (project names, folders, and
// the paths they sit in) for generic labels, so a screenshot or a screen share can't give
// away what they are building. Token counts, costs, tools, and models stay as they are.

const UNKNOWN_FOLDER = "Unknown folder";

/** "Project A" … "Project Z", then "Project AA", "Project AB", and so on. */
export function projectLabelAt(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Project ${letters}`;
}

const pathOf = (label: string) => `~/projects/${label.toLowerCase().replace(/\s+/g, "-")}`;

export interface Redacted {
  data: DashboardPayload;
  /** The label for a project's folder name, as the Live view reports it; the same name always gets the same label. */
  labelOf: (name: string) => string;
}

/**
 * Projects are labeled by size, so Project A is the one with the most tokens and the labels
 * hold still as usage grows. Sessions that record no folder keep no folder.
 */
export function redactPayload(data: DashboardPayload): Redacted {
  const keyOf = (s: SessionEntry) => s.projectRoot ?? (s.projectName ? `name:${s.projectName}` : null);

  const tokens = new Map<string, number>();
  for (const s of data.sessions) {
    const key = keyOf(s);
    if (key) tokens.set(key, (tokens.get(key) ?? 0) + s.totalTokens);
  }
  const ordered = [...tokens.keys()].sort((a, b) => tokens.get(b)! - tokens.get(a)! || a.localeCompare(b));
  const labels = new Map(ordered.map((key, i) => [key, projectLabelAt(i)]));

  // A folder name from the Live view is matched to the project whose sessions carry that name.
  const byName = new Map<string, string>();
  for (const key of ordered) {
    const name = data.sessions.find((s) => keyOf(s) === key && s.projectName)?.projectName;
    if (name && !byName.has(name)) byName.set(name, labels.get(key)!);
  }
  let next = labels.size;
  const labelOf = (name: string) => {
    let label = byName.get(name);
    if (!label) {
      label = projectLabelAt(next++);
      byName.set(name, label);
    }
    return label;
  };

  const sessions = data.sessions.map((s): SessionEntry => {
    const key = keyOf(s);
    const label = key ? labels.get(key)! : null;
    const { cwd: _cwd, projectName: _name, projectRoot: _root, ...rest } = s;
    return label
      ? { ...rest, projectName: label, projectRoot: pathOf(label), cwd: pathOf(label), projectPath: pathOf(label) }
      : { ...rest, projectPath: UNKNOWN_FOLDER };
  });

  return { data: { ...data, sessions }, labelOf };
}
