import { describe, expect, test } from "bun:test";
import type { HarnessId } from "../../types.ts";
import { Models } from "./Models.tsx";
import { render } from "../testing/dashboard.tsx";

const verified = () => render(<Models />, { estimated: false });
const estimate = () => render(<Models />, { estimated: true });

describe("Models tab in Verified mode", () => {
  test("lists usage only, with no price section", () => {
    const html = verified();
    expect(html).toContain("claude-opus-5-5");
    expect(html).not.toContain("Model prices");
    expect(html).not.toContain("openrouter.ai");
    expect(html).not.toContain("Listed as");
  });

  test("keeps the Unpriced tag for models ccusage can't price, without estimate tags", () => {
    const html = verified();
    expect(html).toContain(">Unpriced<");
    expect(html).not.toContain(">Estimated<");
    expect(html).not.toContain(">No price<");
  });
});

describe("Models tab in Estimate mode", () => {
  test("adds a Model prices section after the usage table, anchored for the redirect", () => {
    const html = estimate();
    expect(html).toContain('id="model-prices"');
    expect(html).toContain(">Model prices<");
    expect(html.indexOf("model-prices")).toBeGreaterThan(html.indexOf("<table"));
  });

  test("says where the prices come from and how they are fetched", () => {
    const html = estimate();
    expect(html).toContain("openrouter.ai/api/v1/models");
    expect(html).toContain("once a day");
    expect(html).toContain("saved on this computer");
    expect(html).toContain("nothing about your usage is sent");
  });

  test("explains how names are matched and what an estimate leaves out", () => {
    const html = estimate();
    expect(html).toContain("longest prefix");
    expect(html).toContain("long-context");
    expect(html).toContain("TOKEN_LARPER_OFFLINE=1");
    expect(html).toContain("ccusage");
  });

  test("shows how fresh the list is", () => {
    expect(estimate()).toContain("346 models, updated 2 h ago");
  });

  test("shows each price with the OpenRouter listing it came from", () => {
    const html = estimate();
    expect(html).toContain("Listed as");
    // claude-opus-5-5 is listed as claude-opus-5.5: $4 in, $20 out, $5 cache write, $0.20 cache read.
    expect(html).toContain("claude-opus-5.5");
    for (const price of ["$4.00", "$20.00", "$5.00", "$0.20"]) expect(html).toContain(price);
  });

  test("marks models with no price and leaves them out of the estimate", () => {
    const html = estimate();
    expect(html).toContain(">Estimated<");
    expect(html).toContain(">No price<");
    expect(html).toContain("Not on OpenRouter&#x27;s price list");
    // The unpriced model's cost cell is a dash, not $0.00.
    expect(html).toContain("<td class=\"num\">—</td>");
  });

  test("tags a model ccusage already prices as ccusage, not with a list price", () => {
    expect(estimate()).toContain(">ccusage<");
  });
});

test("Estimate mode keeps every usage row and only adds the price section", () => {
  const rows = (html: string) => (html.match(/<tr>/g) ?? []).length;
  // Three models in the usage table; Estimate adds a header and three rows for the prices.
  expect(rows(estimate())).toBe(rows(verified()) + 4);
});

describe("Speed column", () => {
  const throughput = (responses: number) => ({
    byHarness: new Map(),
    byModel: new Map([["claude::claude-opus-5-5", { responses, tokensPerSecond: 97.3, median: 84.1, p90: 123.1 }]]),
    activeMs: new Map(),
    timedByTool: new Set<HarnessId>(["pi"]),
  });

  test("marks speeds approximate, explains the first-token wait on hover, and dashes the rest", () => {
    const html = render(<Models />, { throughput: throughput(1632) });
    expect(html).toContain(">Speed<");
    expect(html).toContain('<td class="num" title="Approximate output tokens per second over 1,632 responses');
    expect(html).toContain("≈97.3 tok/s");
    expect(html).toContain("waiting for the first token");
    expect(html).toContain("Speed is approximate");
    expect(html).toContain('<td class="num muted">—</td>');
  });

  test("dims a speed from only a few responses and says so", () => {
    const html = render(<Models />, { throughput: throughput(2) });
    expect(html).toContain('<td class="num muted" title="Only 2 responses in this range, so treat this as rough.');
  });

  test("dashes every model before the first scan finishes", () => {
    const html = render(<Models />);
    expect(html).not.toContain("tok/s");
    expect(html).not.toContain("Speed is approximate");
  });
});
