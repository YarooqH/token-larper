import React, { createContext, useContext } from "react";
import type { DashboardPayload, HarnessId, LimitsPayload, SessionEntry, TimePeriodRow } from "../types.ts";
import type { HarnessFilter } from "./lib/aggregate.ts";
import type { DateRange } from "./lib/range.ts";
import type { RangeThroughput } from "./lib/throughput.ts";
import type { SeriesInfo } from "./charts.tsx";
import { ToolMark } from "./components/ToolMark.tsx";

export interface Dashboard {
  data: DashboardPayload;
  range: DateRange;
  harness: HarnessFilter;
  setHarness: (h: HarnessFilter) => void;
  estimated: boolean;
  costOf: (c: { verifiedCost: number; estimatedCost: number }) => number;
  /** Days with usage in the selected range, narrowed to the selected tool. */
  days: TimePeriodRow[];
  /** Sessions whose last activity falls in the range, narrowed to the selected tool. */
  sessions: SessionEntry[];
  /** Output speed and working time in the range, narrowed to the selected tool; null until the first scan ends. */
  throughput?: RangeThroughput | null;
  /** Subscription rate limits and remaining quota windows across harnesses. */
  limits?: LimitsPayload | null;
  series: SeriesInfo[];
  seriesOf: (id: HarnessId) => SeriesInfo;
  nameOf: (id: HarnessId) => string;
  search: string;
  /** Switch to the Models view and scroll to its list prices. */
  openModelPrices: () => void;
  /** Switch to the Limits view. */
  openLimits?: () => void;
  /** In screenshot mode, the generic label for a project's folder name; absent otherwise. */
  projectLabel?: (name: string) => string;
}

const DashboardContext = createContext<Dashboard | null>(null);

export const DashboardProvider = DashboardContext.Provider;

export function useDashboard(): Dashboard {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard needs a DashboardProvider");
  return ctx;
}

/** A project's folder name as it should be shown: itself, or its generic label in screenshot mode. */
export function useProjectLabel(): (name: string) => string {
  return useDashboard().projectLabel ?? ((name) => name);
}

export function ToolTag({ id }: { id: HarnessId }) {
  const { seriesOf, nameOf } = useDashboard();
  return (
    <span className="tool-tag">
      <ToolMark harness={id} name={nameOf(id)} color={seriesOf(id).color} decorative />
      {nameOf(id)}
    </span>
  );
}

/** A tool's mark, named for screen readers; for spots without room for the name. */
export function HarnessMark({ id, size }: { id: HarnessId; size?: number }) {
  const { seriesOf, nameOf } = useDashboard();
  return <ToolMark harness={id} name={nameOf(id)} color={seriesOf(id).color} size={size} />;
}

/** A thin inline bar for a row's share of the largest row in the table. */
export function ShareBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 1.5 : 0, (value / max) * 100) : 0;
  return (
    <span className="share-bar" aria-hidden="true">
      <span style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function pct(part: number, whole: number, digits = 1): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : "0%";
}
