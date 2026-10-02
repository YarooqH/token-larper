import { describe, expect, test } from "bun:test";
import { KpiCards } from "./KpiCards.tsx";
import { render } from "../testing/dashboard.tsx";

describe("cost card on the Overview", () => {
  test("hints at where the estimate comes from, in Estimate mode only", () => {
    const html = render(<KpiCards />, { estimated: true });
    expect(html).toContain("Estimated API value");
    expect(html).toContain("How this is estimated");
  });

  test("shows no price hint in Verified mode", () => {
    const html = render(<KpiCards />, { estimated: false });
    expect(html).toContain("Verified cost");
    expect(html).not.toContain("How this is estimated");
    expect(html).not.toContain("model prices");
    expect(html).not.toContain("kpi-link");
  });
});
