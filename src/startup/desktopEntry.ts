import { posix } from "node:path";

// The Linux XDG autostart entry as text. Reading and writing the file is in linux.ts.

export const DESKTOP_FILE_NAME = "token-larper.desktop";

/** The XDG spec ignores a relative XDG_CONFIG_HOME. */
export function autostartDir(env: { XDG_CONFIG_HOME?: string }, home: string): string {
  const config = env.XDG_CONFIG_HOME && posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : posix.join(home, ".config");
  return posix.join(config, "autostart");
}

/** Quote one Exec argument; inside quotes, \ " ` and $ take a backslash. */
function quoteArg(arg: string): string {
  if (/[\r\n]/.test(arg)) throw new Error("A path with a line break can't go in an autostart entry");
  return `"${arg.replace(/[\\"`$]/g, "\\$&")}"`;
}

export function buildDesktopEntry(o: { bun: string; cliJs: string }): string {
  const exec = `${quoteArg(o.bun)} ${quoteArg(o.cliJs)} --boot`;
  // % starts a field code, and the string escape rule (\\ for \) applies on top of the
  // quoting, so a literal backslash ends up as four.
  const value = exec.replace(/%/g, "%%").replace(/\\/g, "\\\\");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Token Larper",
    "Comment=Start the Token Larper dashboard at login",
    `Exec=${value}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** Desktops turn an autostart entry off with Hidden=true or X-GNOME-Autostart-enabled=false. */
export function parseDesktopEntry(text: string): { args: string[] | null; disabled: boolean } {
  let inMain = false;
  let exec: string | null = null;
  let disabled = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inMain = line === "[Desktop Entry]";
      continue;
    }
    if (!inMain || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "Exec") exec = value;
    else if (key === "Hidden" && value === "true") disabled = true;
    else if (key === "X-GNOME-Autostart-enabled" && value === "false") disabled = true;
  }
  return { args: exec === null ? null : splitExec(exec), disabled };
}

const STRING_ESCAPES: Record<string, string> = { "\\": "\\", s: " ", n: "\n", t: "\t", r: "\r" };

/** Split an Exec value into arguments, undoing buildDesktopEntry's escaping. */
export function splitExec(value: string): string[] {
  const exec = value.replace(/\\([\\sntr])/g, (_, c: string) => STRING_ESCAPES[c]!);
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let inArg = false;
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i]!;
    if (quoted) {
      if (c === "\\" && i + 1 < exec.length) current += exec[++i]!;
      else if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"') {
      quoted = true;
      inArg = true;
    } else if (c === " " || c === "\t") {
      if (inArg) args.push(current);
      current = "";
      inArg = false;
    } else {
      current += c;
      inArg = true;
    }
  }
  if (inArg) args.push(current);
  return args.map((a) => a.replace(/%%/g, "%"));
}
