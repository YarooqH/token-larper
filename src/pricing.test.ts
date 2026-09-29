import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPriceTable, createPricing, lookupRates, normalizeModelName } from "./pricing.ts";

// Trimmed copies of real https://openrouter.ai/api/v1/models entries (prices are USD per token).
const MODELS = [
  { id: "anthropic/claude-opus-5.5", pricing: { prompt: "0.000004", completion: "0.00002", input_cache_read: "0.0000002", input_cache_write: "0.000005" } },
  { id: "anthropic/claude-opus-4.1", pricing: { prompt: "0.000015", completion: "0.000075", input_cache_read: "0.0000015", input_cache_write: "0.00001875" } },
  { id: "anthropic/claude-opus-4", pricing: { prompt: "0.000015", completion: "0.000075", input_cache_read: "0.0000015", input_cache_write: "0.00001875" } },
  { id: "openai/gpt-4o", pricing: { prompt: "0.0000025", completion: "0.00001", input_cache_read: "0.00000125" } },
  { id: "openai/gpt-4o-2024-05-13", pricing: { prompt: "0.000005", completion: "0.000015" } },
  { id: "openai/gpt-5.5", pricing: { prompt: "0.000005", completion: "0.00003", input_cache_read: "0.0000005" } },
  { id: "openai/o3", pricing: { prompt: "0.000002", completion: "0.000008", input_cache_read: "0.0000005" } },
  { id: "openai/o3-mini", pricing: { prompt: "0.0000011", completion: "0.0000044", input_cache_read: "0.00000055" } },
  { id: "minimax/minimax-m3", pricing: { prompt: "0.0000003", completion: "0.0000012", input_cache_read: "0.00000006" } },
];

describe("normalizeModelName", () => {
  test("turns dashed versions into dotted ones", () => {
    expect(normalizeModelName("claude-opus-4-5-20251101")).toBe("claude-opus-4.5-20251101");
    expect(normalizeModelName("claude-3-5-haiku-20241022")).toBe("claude-3.5-haiku-20241022");
    expect(normalizeModelName("llama-3-1-70b")).toBe("llama-3.1-70b");
  });

  test("drops the harness tag, provider prefix, variant tag and case", () => {
    expect(normalizeModelName("[pi] Claude-Opus-5")).toBe("claude-opus-5");
    expect(normalizeModelName("anthropic/claude-sonnet-4.5")).toBe("claude-sonnet-4.5");
    expect(normalizeModelName("qwen/qwen3-coder:free")).toBe("qwen3-coder");
  });

  test("leaves dates and long numbers alone", () => {
    expect(normalizeModelName("gpt-4o-2024-11-20")).toBe("gpt-4o-2024-11-20");
    expect(normalizeModelName("kimi-k2-0905")).toBe("kimi-k2-0905");
    expect(normalizeModelName("gpt-4-1106-preview")).toBe("gpt-4-1106-preview");
  });
});

describe("buildPriceTable", () => {
  test("converts per-token prices to per-1M without float noise", () => {
    const table = buildPriceTable(MODELS);
    // [input, output, cacheWrite, cacheRead]; 0.0000002 * 1e6 is 0.19999999999999998 unrounded.
    expect(table.get("claude-opus-5.5")).toEqual([4, 20, 5, 0.2]);
  });

  test("skips variants, floating aliases and unusable prices", () => {
    const table = buildPriceTable([
      { id: "qwen/qwen3-coder:free", pricing: { prompt: "0", completion: "0" } },
      { id: "anthropic/claude-opus-5.5:batch", pricing: { prompt: "0.000002", completion: "0.00001" } },
      { id: "~anthropic/claude-opus-latest", pricing: { prompt: "0.000004", completion: "0.00002" } },
      { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } },
      { id: "stealth/free-ish", pricing: { prompt: "0", completion: "0" } },
      { id: "acme/no-pricing" },
      { id: "acme/output-missing", pricing: { prompt: "0.000001" } },
      { id: "acme/ok", pricing: { prompt: "0.000001", completion: "0.000002" } },
    ]);
    expect([...table.keys()]).toEqual(["ok"]);
  });

  test("fills a missing cache price from the input price", () => {
    const table = buildPriceTable([
      { id: "anthropic/claude-x", pricing: { prompt: "0.000002", completion: "0.00001" } },
      { id: "acme/plain", pricing: { prompt: "0.000002", completion: "0.00001" } },
    ]);
    // Anthropic bills cache writes at 1.25x and reads at 0.1x; other providers get no discount.
    expect(table.get("claude-x")).toEqual([2, 10, 2.5, 0.2]);
    expect(table.get("plain")).toEqual([2, 10, 2, 2]);
  });

  test("keeps a cache price that really is zero", () => {
    const table = buildPriceTable([
      { id: "acme/free-cache", pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0" } },
    ]);
    expect(table.get("free-cache")).toEqual([2, 10, 2, 0]);
  });

  test("keeps the first listing when two ids normalize to one name", () => {
    const table = buildPriceTable([
      { id: "a/same", pricing: { prompt: "0.000001", completion: "0.000002" } },
      { id: "b/same", pricing: { prompt: "0.000009", completion: "0.000009" } },
    ]);
    expect(table.get("same")).toEqual([1, 2, 1, 1]);
  });
});

describe("lookupRates", () => {
  const table = buildPriceTable(MODELS);

  test("finds a model however ccusage spells it", () => {
    expect(lookupRates("claude-opus-5-5", table)).toEqual([4, 20, 5, 0.2]);
    expect(lookupRates("[pi] anthropic/claude-opus-5.5", table)).toEqual([4, 20, 5, 0.2]);
    expect(lookupRates("claude-opus-4-1-20250805", table)).toEqual([15, 75, 18.75, 1.5]);
    expect(lookupRates("claude-opus-4-20250514", table)).toEqual([15, 75, 18.75, 1.5]);
  });

  test("prefers the exact dated listing over the undated model", () => {
    expect(lookupRates("gpt-4o", table)).toEqual([2.5, 10, 2.5, 1.25]);
    expect(lookupRates("gpt-4o-2024-05-13", table)).toEqual([5, 15, 5, 5]);
  });

  test("falls back to the longest listed name that prefixes it", () => {
    expect(lookupRates("gpt-5.5-codex", table)).toEqual(lookupRates("gpt-5.5", table));
    expect(lookupRates("o3-mini-high", table)).toEqual(lookupRates("o3-mini", table));
  });

  test("does not treat a shorter version as a prefix of a longer one", () => {
    // "claude-opus-4" is listed, but "claude-opus-4.9" is a different model.
    expect(lookupRates("claude-opus-4.9", table)).toBeNull();
    expect(lookupRates("claude-opus-5", table)).toBeNull();
  });

  test("returns null for unlisted or empty names", () => {
    expect(lookupRates("gpt-6-sol", table)).toBeNull();
    expect(lookupRates("", table)).toBeNull();
    expect(lookupRates("[pi]", table)).toBeNull();
  });
});

describe("createPricing", () => {
  const dir = mkdtempSync(join(tmpdir(), "token-larper-pricing-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const HOUR = 60 * 60 * 1000;
  const START = Date.UTC(2026, 8, 30);
  let n = 0;
  const cachePath = () => join(dir, `prices-${n++}.json`);
  const okFetch = (calls: { count: number }) => async () => {
    calls.count++;
    return new Response(JSON.stringify({ data: MODELS }));
  };

  test("downloads the price list, caches it, and answers lookups", async () => {
    const calls = { count: 0 };
    const cacheFile = cachePath();
    const pricing = createPricing({ cacheFile, fetchImpl: okFetch(calls) });

    await pricing.ensure();

    expect(calls.count).toBe(1);
    expect(pricing.lookup("minimax-m3")).toEqual([0.3, 1.2, 0.3, 0.06]);
    expect(existsSync(cacheFile)).toBe(true);
  });

  test("starts from a fresh cache without touching the network", async () => {
    const cacheFile = cachePath();
    let now = START;
    await createPricing({ cacheFile, fetchImpl: okFetch({ count: 0 }), now: () => now }).ensure();

    now += 23 * HOUR;
    const calls = { count: 0 };
    const pricing = createPricing({ cacheFile, fetchImpl: okFetch(calls), now: () => now });
    await pricing.ensure();

    expect(calls.count).toBe(0);
    expect(pricing.lookup("minimax-m3")).toEqual([0.3, 1.2, 0.3, 0.06]);
  });

  test("downloads again once the cache is a day old", async () => {
    const cacheFile = cachePath();
    let now = START;
    await createPricing({ cacheFile, fetchImpl: okFetch({ count: 0 }), now: () => now }).ensure();

    now += 25 * HOUR;
    const calls = { count: 0 };
    await createPricing({ cacheFile, fetchImpl: okFetch(calls), now: () => now }).ensure();

    expect(calls.count).toBe(1);
  });

  test("keeps the stale prices when the download fails, and retries later rather than every call", async () => {
    const cacheFile = cachePath();
    let now = START;
    await createPricing({ cacheFile, fetchImpl: okFetch({ count: 0 }), now: () => now }).ensure();

    now += 25 * HOUR;
    let attempts = 0;
    const failing = async (): Promise<Response> => {
      attempts++;
      throw new Error("offline");
    };
    const pricing = createPricing({ cacheFile, fetchImpl: failing, now: () => now });

    await pricing.ensure();
    await pricing.ensure();
    expect(attempts).toBe(1);
    expect(pricing.lookup("minimax-m3")).toEqual([0.3, 1.2, 0.3, 0.06]);

    now += HOUR;
    await pricing.ensure();
    expect(attempts).toBe(2);
  });

  test("ignores an empty or failed response instead of wiping the table", async () => {
    const cacheFile = cachePath();
    let now = START;
    await createPricing({ cacheFile, fetchImpl: okFetch({ count: 0 }), now: () => now }).ensure();

    now += 25 * HOUR;
    for (const body of [() => new Response(JSON.stringify({ data: [] })), () => new Response("nope", { status: 503 })]) {
      const pricing = createPricing({ cacheFile, fetchImpl: async () => body(), now: () => now });
      await pricing.ensure();
      expect(pricing.lookup("minimax-m3")).toEqual([0.3, 1.2, 0.3, 0.06]);
    }
  });

  test("answers from the newest table after a lookup was already made", async () => {
    let now = START;
    const pricing = createPricing({ cacheFile: cachePath(), fetchImpl: okFetch({ count: 0 }), now: () => now });
    expect(pricing.lookup("minimax-m3")).toBeNull();

    pricing.use(buildPriceTable([{ id: "minimax/minimax-m3", pricing: { prompt: "0.000001", completion: "0.000002" } }]));
    expect(pricing.lookup("minimax-m3")).toEqual([1, 2, 1, 1]);

    now += 25 * HOUR;
    await pricing.ensure();
    expect(pricing.lookup("minimax-m3")).toEqual([0.3, 1.2, 0.3, 0.06]);
  });

  test("shares one download between concurrent callers", async () => {
    const calls = { count: 0 };
    const pricing = createPricing({ cacheFile: cachePath(), fetchImpl: okFetch(calls) });

    await Promise.all([pricing.ensure(), pricing.ensure(), pricing.ensure()]);

    expect(calls.count).toBe(1);
  });

  test("survives a corrupt cache file", async () => {
    const cacheFile = cachePath();
    writeFileSync(cacheFile, "{not json");
    const calls = { count: 0 };
    const pricing = createPricing({ cacheFile, fetchImpl: okFetch(calls) });

    await pricing.ensure();

    expect(calls.count).toBe(1);
    expect(pricing.lookup("minimax-m3")).toEqual([0.3, 1.2, 0.3, 0.06]);
  });

  test("makes no request when TOKEN_LARPER_OFFLINE is set", async () => {
    const previous = process.env.TOKEN_LARPER_OFFLINE;
    process.env.TOKEN_LARPER_OFFLINE = "1";
    try {
      const calls = { count: 0 };
      const pricing = createPricing({ cacheFile: cachePath(), fetchImpl: okFetch(calls) });
      await pricing.ensure();
      expect(calls.count).toBe(0);
      expect(pricing.lookup("minimax-m3")).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.TOKEN_LARPER_OFFLINE;
      else process.env.TOKEN_LARPER_OFFLINE = previous;
    }
  });
});
