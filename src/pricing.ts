import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./paths.ts";

// Model prices for the estimated cost. OpenRouter publishes a public price list that
// tracks new models faster than a table kept in this repo. The one request goes to its
// models endpoint (no key, no usage data sent) at most once a day; the result is cached
// in the data folder and the built-in rates in ccusage.ts cover whatever it does not list.
// Set TOKEN_LARPER_OFFLINE=1 to skip the request and use only the cache and built-in rates.

/** USD per 1M tokens: input, output, cache write, cache read. */
export type Rates = [input: number, output: number, cacheWrite: number, cacheRead: number];

export type PriceTable = Map<string, Rates>;

export interface OpenRouterModel {
  id: string;
  pricing?: Record<string, unknown>;
}

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const REFRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 8000;

/**
 * Reduces a model name to the form both ccusage and OpenRouter can be compared in:
 * lower case, without the harness tag ("[pi] "), provider ("anthropic/") or variant
 * (":free"), and with dashed versions dotted ("4-5" becomes "4.5").
 */
export function normalizeModelName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/^.*\//, "")
    .replace(/:.*$/, "");

  const parts = slug.split("-");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const next = parts[i + 1];
    // A pair of short numbers is a version ("opus-4-5"), unless it follows a year
    // ("2024-11-20" is a date).
    const followsYear = /^\d{4}$/.test(parts[i - 1] ?? "");
    if (next !== undefined && !followsYear && /^\d{1,2}$/.test(part) && /^\d{1,2}$/.test(next)) {
      out.push(`${part}.${next}`);
      i++;
    } else {
      out.push(part);
    }
  }
  return out.join("-");
}

// Multiplying a per-token price by 1e6 leaves float noise (0.0000002 * 1e6 is
// 0.19999999999999998).
const perMillion = (perToken: number) => Number((perToken * 1e6).toPrecision(10));

/** Absent or invalid is undefined; zero is a real price. */
function cachePrice(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Builds the rate table from OpenRouter's model list. Variants (":free" is $0, ":batch"
 * is half price) and "~...-latest" aliases would misprice a model, and a price of 0 or
 * -1 means free or variable, so none of those are kept. When two ids normalize to the
 * same name, the first listed wins.
 */
export function buildPriceTable(models: readonly OpenRouterModel[]): PriceTable {
  const table: PriceTable = new Map();
  for (const model of models) {
    if (typeof model?.id !== "string" || model.id.startsWith("~") || model.id.includes(":")) continue;
    const input = Number(model.pricing?.prompt);
    const output = Number(model.pricing?.completion);
    if (!(input > 0) || !(output > 0)) continue;

    const key = normalizeModelName(model.id);
    if (!key || table.has(key)) continue;

    // Anthropic bills cache writes at 1.25x input and reads at 0.1x. Elsewhere a missing
    // cache price means no discount is known, so cached tokens cost the input price.
    const anthropic = model.id.startsWith("anthropic/");
    const cacheWrite = cachePrice(model.pricing?.input_cache_write) ?? (anthropic ? input * 1.25 : input);
    const cacheRead = cachePrice(model.pricing?.input_cache_read) ?? (anthropic ? input * 0.1 : input);
    table.set(key, [perMillion(input), perMillion(output), perMillion(cacheWrite), perMillion(cacheRead)]);
  }
  return table;
}

/**
 * The rates for a model name, or null if the table has none. An exact match wins;
 * otherwise the longest listed name that prefixes it at a dash ("gpt-5.5-codex" finds
 * "gpt-5.5", and "claude-opus-4-20250514" finds "claude-opus-4"). A prefix must end at
 * a dash so "claude-opus-4.9" never borrows the price of "claude-opus-4".
 */
export function lookupRates(modelName: string, table: PriceTable): Rates | null {
  const key = normalizeModelName(modelName);
  if (!key) return null;

  const exact = table.get(key);
  if (exact) return exact;

  let best: string | undefined;
  for (const listed of table.keys()) {
    if (key.startsWith(`${listed}-`) && (!best || listed.length > best.length)) best = listed;
  }
  return best ? table.get(best)! : null;
}

const isRates = (value: unknown): value is Rates =>
  Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);

export interface PricingOptions {
  cacheFile?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}

export function createPricing(options: PricingOptions = {}) {
  const cacheFile = options.cacheFile ?? dataPath("openrouter-pricing.json");
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  let table: PriceTable = new Map();
  // The same few model names repeat across every daily row, and an unlisted name scans
  // the whole table, so answers are remembered until the table changes.
  let answers = new Map<string, Rates | null>();
  let fetchedAt = 0;
  let nextAttempt = 0;
  let cacheRead = false;
  let inFlight: Promise<void> | null = null;

  function setTable(next: PriceTable): void {
    table = next;
    answers = new Map();
  }

  function readCache(): void {
    try {
      const stored = JSON.parse(readFileSync(cacheFile, "utf8")) as { fetchedAt?: unknown; rates?: Record<string, unknown> };
      const rates: PriceTable = new Map();
      for (const [key, value] of Object.entries(stored.rates ?? {})) if (isRates(value)) rates.set(key, value);
      if (typeof stored.fetchedAt === "number" && rates.size > 0) {
        setTable(rates);
        fetchedAt = stored.fetchedAt;
      }
    } catch {
      // No cache yet, or it is unreadable; the next download replaces it.
    }
  }

  async function download(): Promise<void> {
    try {
      const res = await doFetch(MODELS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`OpenRouter responded ${res.status}`);
      const body = (await res.json()) as { data?: unknown };
      if (!Array.isArray(body.data)) throw new Error("OpenRouter response had no model list");

      const fresh = buildPriceTable(body.data);
      // An empty list would wipe good prices, so treat it as a failed download.
      if (fresh.size === 0) throw new Error("OpenRouter response had no usable prices");

      setTable(fresh);
      fetchedAt = now();
      try {
        mkdirSync(dirname(cacheFile), { recursive: true });
        writeFileSync(cacheFile, JSON.stringify({ fetchedAt, rates: Object.fromEntries(fresh) }), "utf8");
      } catch {
        // The in-memory prices still work when the disk is not writable.
      }
    } catch {
      // Offline or the endpoint changed: keep what we have and try again later.
      nextAttempt = now() + RETRY_MS;
    }
  }

  return {
    /** Rates from the OpenRouter table, or null when it has no price for this model. */
    lookup(modelName: string): Rates | null {
      let rates = answers.get(modelName);
      if (rates === undefined) {
        rates = lookupRates(modelName, table);
        answers.set(modelName, rates);
      }
      return rates;
    },

    /** Replaces the in-memory table. */
    use: setTable,

    /** Loads the cached table, and downloads a new one if it is over a day old. Never throws. */
    async ensure(): Promise<void> {
      if (!cacheRead) {
        cacheRead = true;
        readCache();
      }
      if (process.env.TOKEN_LARPER_OFFLINE === "1") return;
      if (now() - fetchedAt < REFRESH_MS || now() < nextAttempt) return;
      inFlight ??= download().finally(() => (inFlight = null));
      await inFlight;
    },
  };
}

export const pricing = createPricing();
