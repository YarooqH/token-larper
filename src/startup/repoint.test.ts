import { expect, test } from "bun:test";
import { shouldRepoint } from "./repoint.ts";

const entry = { entry: "bun /old/bin/cli.js --boot", target: "/old/bin/cli.js", disabledBySystem: false };
const base = { state: entry, isThisCopy: false, targetExists: true, targetVersion: "1.11.0", appVersion: "1.12.0" };

test("an entry for an older copy is repointed", () => {
  expect(shouldRepoint(base)).toBe(true);
});

test("an entry for a deleted copy is repointed", () => {
  expect(shouldRepoint({ ...base, targetExists: false, targetVersion: null })).toBe(true);
});

test("an entry for this copy, a newer copy or the same version is left alone", () => {
  expect(shouldRepoint({ ...base, isThisCopy: true })).toBe(false);
  expect(shouldRepoint({ ...base, targetVersion: "1.13.0" })).toBe(false);
  expect(shouldRepoint({ ...base, targetVersion: "1.12.0" })).toBe(false);
});

test("a beta entry is repointed to its release", () => {
  expect(shouldRepoint({ ...base, targetVersion: "1.12.0-beta.2" })).toBe(true);
});

test("no entry, or one the user turned off in the OS, is never touched", () => {
  expect(shouldRepoint({ ...base, state: { entry: null, target: null, disabledBySystem: false } })).toBe(false);
  expect(shouldRepoint({ ...base, state: { ...entry, disabledBySystem: true } })).toBe(false);
});
