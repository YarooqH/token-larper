import type { StartupConfig } from "../../types.ts";

/**
 * Startup wording for Settings. Windows keeps its existing text. When the user turned the
 * macOS login item off in System Settings, only System Settings can turn it back on, so
 * the switch is disabled there instead of overriding their choice.
 */
export function startupCopy(s: Pick<StartupConfig, "platform" | "enabled" | "disabledBySystem">) {
  const windows = s.platform === "windows";
  const macos = s.platform === "macos";
  const toggleLabel = windows ? "Start with Windows" : "Start at login";

  let status = "Manual launch";
  if (s.enabled) status = windows ? "Starts with Windows" : "Starts at login";
  else if (s.disabledBySystem) status = macos ? "Turned off in System Settings" : "Turned off in your desktop's startup settings";

  let toggleHint = "Launch Token Larper when you sign in.";
  if (s.disabledBySystem) {
    toggleHint = macos
      ? "Turn Token Larper back on in System Settings → General → Login Items."
      : "Your desktop's startup settings turned it off. Switch it on here to start it at login again.";
  }

  return {
    toggleLabel,
    status,
    toggleHint,
    toggleDisabled: macos && s.disabledBySystem,
    browserHint: s.enabled ? "Open the dashboard in your browser after launch." : `Takes effect when ${toggleLabel} is on.`,
    entryLabel: windows ? "Windows startup" : macos ? "Login item" : "Autostart entry",
  };
}
