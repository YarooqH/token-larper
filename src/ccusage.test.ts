import { afterEach, describe, expect, test } from "bun:test";
import { claudeRates, estimateFrontierCost } from "./ccusage.ts";
import { buildPriceTable, pricing } from "./pricing.ts";

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

describe("estimateFrontierCost", () => {
  const oneMillion = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 1_000_000, cacheReadTokens: 1_000_000 };
  afterEach(() => pricing.use(new Map()));

  test("prices a model from the OpenRouter table when it is listed", () => {
    pricing.use(
      buildPriceTable([{ id: "minimax/minimax-m3", pricing: { prompt: "0.0000003", completion: "0.0000012", input_cache_read: "0.00000006" } }]),
    );
    // 0.3 input + 1.2 output + 0.3 cache write (no listed price, so the input price) + 0.06 cache read
    expect(estimateFrontierCost({ modelName: "minimax-m3", ...oneMillion })).toBeCloseTo(1.86, 6);
  });

  test("uses the built-in rates for a model OpenRouter does not list", () => {
    pricing.use(buildPriceTable([{ id: "openai/gpt-5.5", pricing: { prompt: "0.000005", completion: "0.00003" } }]));
    expect(estimateFrontierCost({ modelName: "gpt-6-sol", ...oneMillion })).toBeCloseTo(2.5 + 10 + 2.5 + 0.25, 6);
    expect(estimateFrontierCost({ modelName: "claude-opus-4-1-20250805", ...oneMillion })).toBeCloseTo(15 + 75 + 18.75 + 1.5, 6);
  });

  test("uses the built-in rates when no OpenRouter table has loaded", () => {
    expect(estimateFrontierCost({ modelName: "minimax-m3", ...oneMillion })).toBeCloseTo(0.5 + 2 + 0.5 + 0.1, 6);
  });
});
