import React from "react";
import type { HarnessId } from "../../types.ts";
import type { SpeedSummary } from "../../throughput/stats.ts";
import { useDashboard } from "../context.tsx";
import { FEW_RESPONSES, formatRate, speedTitle } from "../lib/throughput.ts";

/** A table cell with a tool's or model's output speed, marked approximate, or a dash. */
export function SpeedCell({
  harness,
  speed,
  scope = "range",
}: {
  harness: HarnessId;
  speed: SpeedSummary | undefined;
  scope?: "range" | "session";
}) {
  const { throughput } = useDashboard();
  if (!speed || !throughput) return <td className="num muted">—</td>;
  const rough = speed.responses < FEW_RESPONSES;
  return (
    <td className={rough ? "num muted" : "num"} title={speedTitle(speed, throughput.timedByTool.has(harness), scope)}>
      ≈{formatRate(speed.tokensPerSecond)} tok/s
    </td>
  );
}
