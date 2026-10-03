import { expect, test } from "bun:test";
import { buildPlist, isLabelDisabled, LAUNCH_AGENT_LABEL, parsePlistArgs } from "./launchAgent.ts";

const paths = {
  bun: "/Users/sam/.bun/bin/bun",
  cliJs: "/Users/sam/.bun/install/cache/token-larper@1.12.0/bin/cli.js",
  logFile: "/Users/sam/Library/Application Support/TokenLarper/login-agent.log",
};

test("the plist has the label and the keys the spec requires", () => {
  const xml = buildPlist(paths);
  expect(xml).toContain(`<key>Label</key>\n  <string>${LAUNCH_AGENT_LABEL}</string>`);
  expect(xml).toContain("<key>RunAtLoad</key>\n  <true/>");
  expect(xml).toContain("<key>AbandonProcessGroup</key>\n  <true/>");
  expect(xml).toContain("<key>LimitLoadToSessionType</key>\n  <string>Aqua</string>");
  expect(xml).toContain(`<key>StandardOutPath</key>\n  <string>${paths.logFile}</string>`);
  expect(xml).toContain(`<key>StandardErrorPath</key>\n  <string>${paths.logFile}</string>`);
});

test("ProgramArguments read back exactly, including spaces and XML characters", () => {
  const tricky = { ...paths, cliJs: `/Users/sam/My <"App's"> & Stuff/bin/cli.js` };
  expect(parsePlistArgs(buildPlist(tricky))).toEqual([tricky.bun, tricky.cliJs, "--boot"]);
  expect(buildPlist(tricky)).not.toContain(`<"App's">`);
});

test("parsePlistArgs returns null without ProgramArguments", () => {
  expect(parsePlistArgs("<plist><dict><key>Label</key><string>x</string></dict></plist>")).toBeNull();
});

test("isLabelDisabled reads both launchctl output styles", () => {
  const newer = `disabled services = {\n\t"com.apple.x" => enabled\n\t"${LAUNCH_AGENT_LABEL}" => disabled\n}`;
  const older = `disabled services = {\n\t"${LAUNCH_AGENT_LABEL}" => true\n}`;
  const enabled = `disabled services = {\n\t"${LAUNCH_AGENT_LABEL}" => enabled\n}`;
  expect(isLabelDisabled(newer)).toBe(true);
  expect(isLabelDisabled(older)).toBe(true);
  expect(isLabelDisabled(enabled)).toBe(false);
  expect(isLabelDisabled(`"com.tokenlarper.agentX" => disabled`)).toBe(false);
});
