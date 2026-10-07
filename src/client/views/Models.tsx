import React, { useMemo } from "react";
import { ModelPrices } from "../components/ModelPrices.tsx";
import { ShareBar, ToolTag, pct, useDashboard } from "../context.tsx";
import { modelTotals } from "../lib/aggregate.ts";
import { formatRate, modelKey, speedTitle } from "../lib/throughput.ts";
import { formatCompactNumber, formatCurrency } from "../utils.ts";

export function Models() {
  const { data, days, costOf, estimated, search, seriesOf, throughput } = useDashboard();
  const all = useMemo(() => modelTotals(days), [days]);
  const total = all.reduce((acc, m) => acc + m.totalTokens, 0);
  const q = search.trim().toLowerCase();
  const models = q ? all.filter((m) => m.modelName.toLowerCase().includes(q) || m.harness.includes(q)) : all;
  const max = all[0]?.totalTokens ?? 0;
  const prices = data.pricing?.models ?? {};
  const priceOf = (name: string) => prices[name] ?? null;

  // Prices only matter in Estimate mode; Verified costs never use them.
  const unpriced = models.filter((m) => m.missingPricing).length;
  const estimatedCount = models.filter((m) => m.missingPricing && priceOf(m.modelName)).length;
  const noPriceCount = models.filter((m) => m.missingPricing && !priceOf(m.modelName)).length;

  return (
    <>
      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Models</h2>
            <p>
              {models.length} {models.length === 1 ? "model" : "models"}
              {q ? ` matching “${search.trim()}”` : ""}.
              {!estimated &&
                unpriced > 0 &&
                ` ${unpriced} ${unpriced === 1 ? "has" : "have"} no verified price. Switch Cost to Estimate to see a list-price value for ${unpriced === 1 ? "it" : "them"}.`}
              {estimated &&
                estimatedCount > 0 &&
                ` ${estimatedCount} ${estimatedCount === 1 ? "has" : "have"} no verified price, so Estimate uses the list price.`}
              {estimated &&
                noPriceCount > 0 &&
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
                <th className="num">Speed</th>
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
                const speed = throughput?.byModel.get(modelKey(m.harness, m.modelName));
                return (
                  <tr key={`${m.harness}-${m.modelName}`}>
                    <td>
                      <code className="model-name">{m.modelName}</code>
                      {m.missingPricing && !estimated && (
                        <span className="tag" title="Not in ccusage's price table, so it has no verified cost.">
                          Unpriced
                        </span>
                      )}
                      {m.missingPricing && estimated && price && (
                        <span className="tag" title="ccusage has no price for this model, so its value is estimated from the list price below.">
                          Estimated
                        </span>
                      )}
                      {m.missingPricing && estimated && !price && (
                        <span className="tag tag-warning" title="No list price is known, so this model is left out of estimates.">
                          No price
                        </span>
                      )}
                    </td>
                    <td><ToolTag id={m.harness} /></td>
                    <td className="bar-col"><ShareBar value={m.totalTokens} max={max} color={seriesOf(m.harness).color} /></td>
                    <td className="num">{formatCompactNumber(m.inputTokens)}</td>
                    <td className="num">{formatCompactNumber(m.outputTokens)}</td>
                    <td className={speed ? "num" : "num muted"} title={speed ? speedTitle(speed, throughput!.exact.has(m.harness)) : undefined}>
                      {speed ? `${formatRate(speed.tokensPerSecond)} tok/s` : "—"}
                    </td>
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

      {estimated && <ModelPrices models={models} priceOf={priceOf} status={data.pricing?.status} />}
    </>
  );
}
