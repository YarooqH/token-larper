import React, { useMemo } from "react";
import type { ModelMetric, ModelPrice, PricingStatus } from "../../types.ts";
import { formatRate, statusLine } from "../lib/prices.ts";

export const MODEL_PRICES_ID = "model-prices";

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

/**
 * The list prices behind the Estimate cost basis, and where they come from. The Models
 * view shows it only in Estimate mode; Verified costs never use these prices.
 */
export function ModelPrices({
  models,
  priceOf,
  status,
}: {
  models: ModelMetric[];
  priceOf: (name: string) => ModelPrice | null;
  status: PricingStatus | undefined;
}) {
  // One row per model name, in the order of the usage table.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return models.filter((m) => !seen.has(m.modelName) && seen.add(m.modelName));
  }, [models]);

  return (
    <section className="panel" id={MODEL_PRICES_ID} aria-labelledby="model-prices-title">
      <header className="panel-head">
        <div>
          <h2 id="model-prices-title">Model prices</h2>
          <p>List prices per 1M tokens for the models above. {statusLine(status)}</p>
        </div>
      </header>

      <div className="price-info">
        <h3>Where these prices come from</h3>
        <p>
          Token Larper downloads OpenRouter's public price list (<code>openrouter.ai/api/v1/models</code>) once a day and
          keeps a copy saved on this computer, so prices still work offline. Only that list is downloaded; nothing about your
          usage is sent.{" "}
          <a href="https://openrouter.ai/models" target="_blank" rel="noreferrer">Browse OpenRouter's models</a>
        </p>
      </div>

      <div className="table-scroll">
        <table className="table price-table">
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Input</th>
              <th className="num">Output</th>
              <th className="num">Cache write</th>
              <th className="num">Cache read</th>
              <th>Listed as</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const price = priceOf(m.modelName);
              return (
                <tr key={m.modelName}>
                  <td><code className="model-name">{m.modelName}</code></td>
                  {price ? (
                    <>
                      {price.rates.map((rate, i) => <td key={i} className="num">{formatRate(rate)}</td>)}
                      <td>{price.source === "openrouter" ? <code className="model-name">{price.match}</code> : <span className="muted">—</span>}</td>
                    </>
                  ) : (
                    <td className="muted" colSpan={5}>
                      {m.missingPricing ? "Not on OpenRouter's price list" : "Not on OpenRouter's price list; ccusage prices it"}
                    </td>
                  )}
                  <td><SourceTag price={price} verified={!m.missingPricing} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="muted table-empty">No models match.</p>}
      </div>

      <div className="price-info">
        <h3>How estimates work</h3>
        <ul>
          <li>
            Verified costs come from ccusage's own price table and are never changed. These prices only fill in models
            ccusage can't price (marked Estimated above).
          </li>
          <li>
            A model's name is matched to OpenRouter's list exactly, then by the longest prefix, so <code>gpt-5.5-codex</code> is
            priced as <code>gpt-5.5</code>. The Listed as column shows the match.
          </li>
          <li>
            A model that isn't on the list is left out of the estimate (No price); nothing is guessed from its name. Claude
            models OpenRouter doesn't list use Anthropic's rates, built into the app.
          </li>
          <li>These are standard rates and don't include long-context surcharges.</li>
          <li>
            To stop the download, start Token Larper with <code>TOKEN_LARPER_OFFLINE=1</code>; it then uses the last saved
            list.
          </li>
        </ul>
      </div>
    </section>
  );
}
