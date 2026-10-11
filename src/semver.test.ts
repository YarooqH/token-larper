import { expect, test } from "bun:test";
import { compareVersions } from "./semver.ts";

test("compares versions numerically, not as text", () => {
  expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  expect(compareVersions("1.4.0", "1.5.0")).toBe(-1);
  expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  expect(compareVersions("0.0.0", "1.0.2")).toBe(-1);
});

test("ranks prereleases below their release and in order", () => {
  expect(compareVersions("1.5.0-beta.1", "1.5.0")).toBe(-1);
  expect(compareVersions("1.5.0", "1.5.0-beta.1")).toBe(1);
  expect(compareVersions("1.5.0-beta.2", "1.5.0-beta.1")).toBe(1);
  expect(compareVersions("1.5.0-beta.10", "1.5.0-beta.9")).toBe(1);
  expect(compareVersions("1.5.0-beta.1", "1.5.0-beta.1")).toBe(0);
  expect(compareVersions("1.5.0-rc.0", "1.5.0-beta.3")).toBe(1);
  expect(compareVersions("1.5.0-beta", "1.5.0-beta.0")).toBe(-1);
  expect(compareVersions("1.5.0-1", "1.5.0-beta")).toBe(-1);
  expect(compareVersions("1.6.0-beta.0", "1.5.0")).toBe(1);
  expect(compareVersions("1.4.9", "1.5.0-beta.0")).toBe(-1);
});

test("ignores build metadata", () => {
  expect(compareVersions("1.5.0+abc", "1.5.0")).toBe(0);
  expect(compareVersions("1.5.0-beta.1+abc", "1.5.0-beta.1")).toBe(0);
});
