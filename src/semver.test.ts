import { expect, test } from "bun:test";
import { compareVersions } from "./semver.ts";

test("compares versions numerically, not as text", () => {
  expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  expect(compareVersions("1.4.0", "1.5.0")).toBe(-1);
  expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  expect(compareVersions("1.5.0-beta.1", "1.5.0")).toBe(0);
  expect(compareVersions("0.0.0", "1.0.2")).toBe(-1);
});
