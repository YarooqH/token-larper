import { describe, expect, test } from "bun:test";
import { projectLabelAt, redactLimits, redactPayload } from "./screenshot.ts";
import { fakeDashboard } from "../testing/dashboard.tsx";
import type { SessionEntry } from "../../types.ts";

const session = (over: Partial<SessionEntry>): SessionEntry => ({
  id: "s",
  harness: "claude",
  projectPath: "F--Just-Some-Files-secret",
  date: "2026-10-01",
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 100,
  verifiedCost: 1,
  estimatedCost: 1,
  modelsUsed: ["claude-opus-5-5"],
  modelBreakdowns: [],
  ...over,
});

const payload = (sessions: SessionEntry[]) => ({ ...fakeDashboard().data, sessions });

describe("project labels", () => {
  test("run A to Z, then AA, AB, and on", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(projectLabelAt)).toEqual([
      "Project A", "Project B", "Project Z", "Project AA", "Project AB", "Project AZ", "Project BA", "Project ZZ", "Project AAA",
    ]);
  });
});

describe("screenshot mode", () => {
  const sessions = [
    session({ id: "1", projectRoot: "C:/work/acme-billing", projectName: "acme-billing", cwd: "C:/work/acme-billing/api", projectPath: "C--work-acme-billing", totalTokens: 100 }),
    session({ id: "2", projectRoot: "C:/work/secret-startup", projectName: "secret-startup", cwd: "C:/work/secret-startup", totalTokens: 900 }),
    session({ id: "3", projectRoot: "C:/work/acme-billing", projectName: "acme-billing", cwd: "C:/work/acme-billing", totalTokens: 50 }),
    session({ id: "4", harness: "codex", totalTokens: 10 }),
  ];
  const { data, labelOf } = redactPayload(payload(sessions));

  test("labels the biggest project A, and gives every session of one project the same label", () => {
    const names = data.sessions.map((s) => s.projectName);
    expect(names).toEqual(["Project B", "Project A", "Project B", undefined]);
  });

  test("leaves no real name, folder, or path in the sessions", () => {
    const text = JSON.stringify(data.sessions);
    for (const secret of ["acme", "secret", "startup", "billing", "work", "F--Just"]) expect(text).not.toContain(secret);
    expect(data.sessions[0]!.projectRoot).toBe("~/projects/project-b");
    expect(data.sessions[0]!.cwd).toBe("~/projects/project-b");
  });

  test("keeps a session with no recorded folder without one", () => {
    const orphan = data.sessions[3]!;
    expect(orphan.projectRoot).toBeUndefined();
    expect(orphan.projectName).toBeUndefined();
    expect(orphan.cwd).toBeUndefined();
    expect(orphan.projectPath).toBe("Unknown folder");
  });

  test("keeps every number, tool, and model", () => {
    expect(data.sessions.map((s) => [s.id, s.harness, s.totalTokens, s.verifiedCost, s.modelsUsed])).toEqual(
      sessions.map((s) => [s.id, s.harness, s.totalTokens, s.verifiedCost, s.modelsUsed])
    );
    expect(data.totals).toEqual(fakeDashboard().data.totals);
  });

  test("does not change the data it was given", () => {
    expect(sessions[0]!.projectName).toBe("acme-billing");
    expect(sessions[0]!.cwd).toBe("C:/work/acme-billing/api");
  });

  test("labels the Live view's folder names the same way, and new ones after the known projects", () => {
    expect(labelOf("secret-startup")).toBe("Project A");
    expect(labelOf("acme-billing")).toBe("Project B");
    expect(labelOf("brand-new-thing")).toBe("Project C");
    expect(labelOf("brand-new-thing")).toBe("Project C");
    expect(labelOf("another")).toBe("Project D");
  });

  test("handles a name recorded without a root", () => {
    const out = redactPayload(payload([session({ projectName: "lonely", totalTokens: 5 })]));
    expect(out.data.sessions[0]!.projectName).toBe("Project A");
    expect(out.labelOf("lonely")).toBe("Project A");
  });
});

describe("redactLimits", () => {
  test("drops the account from every card and keeps the rest", () => {
    const limits = {
      generatedAt: "2026-10-16T00:00:00Z",
      items: [
        { id: "a", harness: "claude" as const, name: "Claude Code", vendor: "Anthropic", account: "me@example.com", planName: "Claude Pro", source: "live" as const, updatedAt: "2026-10-16T00:00:00Z", windows: [] },
      ],
    };
    const out = redactLimits(limits);
    expect(JSON.stringify(out)).not.toContain("me@example.com");
    expect(out.items[0]?.planName).toBe("Claude Pro");
    expect(limits.items[0]?.account).toBe("me@example.com");
  });
});
