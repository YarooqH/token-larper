// The macOS LaunchAgent plist as text. Reading and writing the file is in macos.ts.

export const LAUNCH_AGENT_LABEL = "com.tokenlarper.agent";

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * Runs `<bun> <cli.js> --boot` once at login, in the GUI session (Aqua) so the menu bar
 * icon can appear. AbandonProcessGroup keeps launchd from stopping the server when the
 * launcher exits.
 */
export function buildPlist(o: { bun: string; cliJs: string; logFile: string }): string {
  const args = [o.bun, o.cliJs, "--boot"].map((a) => `    <string>${escapeXml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>AbandonProcessGroup</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(o.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(o.logFile)}</string>
</dict>
</plist>
`;
}

export function parsePlistArgs(xml: string): string[] | null {
  const array = xml.match(/<key>\s*ProgramArguments\s*<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1];
  if (array === undefined) return null;
  return [...array.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescapeXml(m[1]!));
}

/**
 * Whether `launchctl print-disabled gui/<uid>` lists the label as turned off. Newer macOS
 * prints `"label" => disabled`, older versions `"label" => true`.
 */
export function isLabelDisabled(output: string, label = LAUNCH_AGENT_LABEL): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`"${escaped}"\\s*=>\\s*(true|disabled)\\b`).test(output);
}
