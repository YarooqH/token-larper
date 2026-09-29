import { expect, test } from "bun:test";
import { claudeRates } from "./ccusage.ts";

test("prices Claude models by version", () => {
  expect(claudeRates("claude-opus-5-5")).toEqual([4, 20, 5, 0.2]);
  expect(claudeRates("[pi] claude-opus-5")).toEqual([5, 25, 6.25, 0.5]);
  expect(claudeRates("claude-opus-4-5-20251101")).toEqual([5, 25, 6.25, 0.5]);
  expect(claudeRates("claude-opus-4-1-20250805")).toEqual([15, 75, 18.75, 1.5]);
  expect(claudeRates("claude-opus-4-20250514")).toEqual([15, 75, 18.75, 1.5]);
  expect(claudeRates("claude-sonnet-5-5")).toEqual([2, 10, 2.5, 0.2]);
  expect(claudeRates("claude-sonnet-4-6")).toEqual([3, 15, 3.75, 0.3]);
  expect(claudeRates("claude-haiku-4-5")).toEqual([1, 5, 1.25, 0.1]);
  expect(claudeRates("claude-3-5-haiku-20241022")).toEqual([0.8, 4, 1, 0.08]);
  expect(claudeRates("claude-opus")).toEqual([4, 20, 5, 0.2]);
  expect(claudeRates("gpt-6-sol")).toBeNull();
});
