import React, { useMemo } from "react";
import type { ModelPrice, PricingStatus } from "../../types.ts";
import { ShareBar, ToolTag, pct, useDashboard } from "../context.tsx";
import { modelTotals } from "../lib/aggregate.ts";
import { formatCompactNumber, formatCurrency } from "../utils.ts";

export const MODEL_PRICES_ID = "model-prices";

/** A per-1M rate: cents for most, more digits for sub-cent cache prices. */
function formatRate(rate: number): string {
  if (rate === 0) return "$0";
  return rate < 0.1 ? `$${Number(rate.toPrecision(2))}` : formatCurrency(rate);
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function statusLine(status: PricingStatus | undefined): string {
  if (!status?.fetchedAt) {
    return status?.offline
      ? "Offline, and no OpenRouter price list has been saved yet, so only Anthropic's rates for Claude are known."
      : "OpenRouter's price list hasn't downloaded yet, so only Anthropic's rates for Claude are known.";
  }
  const list = `OpenRouter's price list (${status.models.toLocaleString()} models, updated ${timeAgo(status.fetchedAt)})`;
  if (status.offline) return `From the saved copy of ${list}. Downloads are off.`;
  if (status.lastDownloadFailed) return `From the saved copy of ${list}. The latest download failed and will be retried.`;
  return `From ${list}.`;
}

function SourceTag({ price, verified }: { price: ModelPrice | null; verified: boolean }) {
  if (!price && verified) {
    return <span className="tag" title="ccusage has its own price for this model, so it never needs an estimate.">ccusage</span>;
  }
  if (!price) {
    return (
      <span className="tag tag-warning" title="Not on OpenRouter's price list, so its usage is left out of estimates.">
        No price
      </span>
    );
  }
  return price.source === "openrouter" ? (
    <span className="tag" title={`Matched "${price.match}" on OpenRouter's price list.`}>OpenRouter</span>
  ) : (
    <span className="tag" title="Anthropic's list price, built into Token Larper.">Anthropic</span>
  );
}

export function Models() {
  const { data, days, costOf, estimated, search, seriesOf } = useDashboard();
  const all = useMemo(() => modelTotals(days), [days]);
  const total = all.reduce((acc, m) => acc + m.totalTokens, 0);
  const q = search.trim().toLowerCase();
  const models = q ? all.filter((m) => m.modelName.toLowerCase().includes(q) || m.harness.includes(q)) : all;
  const max = all[0]?.totalTokens ?? 0;
  const prices = data.pricing?.models ?? {};
  const priceOf = (name: string) => prices[name] ?? null;

  const estimatedCount = models.filter((m) => m.missingPricing && priceOf(m.modelName)).length;
  const noPriceCount = models.filter((m) => m.missingPricing && !priceOf(m.modelName)).length;

  // One row per model name, in the order of the usage table.
  const priceRows = useMemo(() => {
    const seen = new Set<string>();
    return models.filter((m) => !seen.has(m.modelName) && seen.add(m.modelName));
  }, [models]);

  return (
    <>
      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Models</h2>
            <p>
              {models.length} {models.length === 1 ? "model" : "models"}
              {q ? ` matching “${search.trim()}”` : ""}.
              {estimatedCount > 0 &&
                ` ${estimatedCount} ${estimatedCount === 1 ? "has" : "have"} no verified price, so "Estimate" uses the list price.`}
              {noPriceCount > 0 &&
                ` ${noPriceCount} ${noPriceCount === 1 ? "has" : "have"} no known price and ${noPriceCount === 1 ? "is" : "are"} left out of estimates.`}
            </p>
          </div>
        </header>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Tool</th>
                <th className="bar-col"><span className="sr-only">Share</span></th>
                <th className="num">Input</th>
                <th className="num">Output</th>
                <th className="num">Cache read</th>
                <th className="num">Cache write</th>
                <th className="num">Total</th>
                <th className="num">Share</th>
                <th className="num">{estimated ? "Est. value" : "Cost"}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const price = priceOf(m.modelName);
                return (
                  <tr key={`${m.harness}-${m.modelName}`}>
                    <td>
                      <code className="model-name">{m.modelName}</code>
                      {m.missingPricing && price && (
                        <span className="tag" title="ccusage has no price for this model, so its value is estimated from the list price below.">
                          Estimated
                        </span>
                      )}
                      {m.missingPricing && !price && (
                        <span className="tag tag-warning" title="No list price is known, so this model is left out of estimates.">
                          No price
                        </span>
                      )}
                    </td>
                    <td><ToolTag id={m.harness} /></td>
                    <td className="bar-col"><ShareBar value={m.totalTokens} max={max} color={seriesOf(m.harness).color} /></td>
                    <td className="num">{formatCompactNumber(m.inputTokens)}</td>
                    <td className="num">{formatCompactNumber(m.outputTokens)}</td>
                    <td className="num">{formatCompactNumber(m.cacheReadTokens)}</td>
                    <td className="num">{formatCompactNumber(m.cacheCreationTokens)}</td>
                    <td className="num strong">{formatCompactNumber(m.totalTokens)}</td>
                    <td className="num muted">{pct(m.totalTokens, total)}</td>
                    <td className="num">{m.missingPricing && !price && estimated ? "—" : formatCurrency(costOf(m))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {models.length === 0 && <p className="muted table-empty">No models match.</p>}
        </div>
      </section>

      <section className="panel" id={MODEL_PRICES_ID} aria-labelledby="model-prices-title">
        <header className="panel-head">
          <div>
            <h2 id="model-prices-title">Model prices</h2>
            <p>
              List prices per 1M tokens for the models above. {statusLine(data.pricing?.status)}{" "}
              <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">Browse OpenRouter's models</a>
            </p>
          </div>
        </header>
        <div className="table-scroll">
          <table className="table price-table">
            <thead>
              <tr>
                <th>Model</th>
                <th className="num">Input</th>
                <th className="num">Output</th>
                <th className="num">Cache write</th>
                <th className="num">Cache read</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {priceRows.map((m) => {
                const price = priceOf(m.modelName);
                return (
                  <tr key={m.modelName}>
                    <td><code className="model-name">{m.modelName}</code></td>
                    {price ? (
                      price.rates.map((rate, i) => <td key={i} className="num">{formatRate(rate)}</td>)
                    ) : (
                      <td className="num muted" colSpan={4}>
                        {m.missingPricing ? "Not on OpenRouter's price list" : "Not on OpenRouter's price list; ccusage prices it"}
                      </td>
                    )}
                    <td><SourceTag price={price} verified={!m.missingPricing} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {priceRows.length === 0 && <p className="muted table-empty">No models match.</p>}
        </div>
        <p className="price-note">
          Verified costs come from ccusage's own price table and are never changed. These list prices
          only fill in models ccusage can't price (marked Estimated above), and don't include long-context
          surcharges.
        </p>
      </section>
    </>
  );
}
