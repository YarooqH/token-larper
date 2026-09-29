import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Moon, Power, RefreshCw, Search, Settings, Sun } from "lucide-react";
import type { DashboardPayload, HarnessId, StartupConfig } from "../types.ts";
import { OTHER_SERIES, SERIES_SLOTS, seriesColor, type SeriesInfo } from "./charts.tsx";
import { DashboardProvider, type Dashboard } from "./context.tsx";
import { DateRangePicker } from "./components/DateRangePicker.tsx";
import { AppFooter } from "./components/AppFooter.tsx";
import { Logo } from "./components/Logo.tsx";
import { RankChip } from "./components/RankChip.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { SelectMenu, type SelectMenuOption } from "./components/SelectMenu.tsx";
import { UpdateBanner } from "./components/UpdateBanner.tsx";
import { useUpdates } from "./lib/updates.ts";
import { daysInRange, sessionsInRange, type Bucket, type HarnessFilter } from "./lib/aggregate.ts";
import { RANGE_PRESETS, parseDay, presetRange, todayKey, type DateRange, type RangePreset } from "./lib/range.ts";
import { Models } from "./views/Models.tsx";
import { Overview } from "./views/Overview.tsx";
import { Projects } from "./views/Projects.tsx";
import { Rank } from "./views/Rank.tsx";
import { Sessions } from "./views/Sessions.tsx";
import { Tools } from "./views/Tools.tsx";
import {
  applyTheme,
  IMPORTED_THEME_STORAGE_KEY,
  readAppearance,
  readImportedTheme,
  saveAppearance,
  THEME_MODE_STORAGE_KEY,
  type Appearance,
  type ImportedTheme,
  type ThemeMode,
} from "./themes.ts";
import { localDateKey } from "./utils.ts";

type View = "overview" | "tools" | "models" | "projects" | "sessions" | "rank";

const VIEWS: { id: View; label: string; title: string; blurb: string }[] = [
  { id: "overview", label: "Overview", title: "Usage overview", blurb: "Tokens and cost across your coding tools." },
  { id: "tools", label: "Tools", title: "Tools", blurb: "How each coding tool was used in this range." },
  { id: "models", label: "Models", title: "Models", blurb: "Token totals by model and tool." },
  { id: "projects", label: "Projects", title: "Projects", blurb: "Where your tokens went, by repository." },
  { id: "sessions", label: "Sessions", title: "Sessions", blurb: "Individual coding sessions." },
  { id: "rank", label: "Rank", title: "Hall of Larp", blurb: "Lifetime rank, rivals, records, and badges. Date and tool filters don't apply here." },
];

// View and filter choices are a per-browser convenience; the dashboard works without them.
const PREFS_KEY = "token-larper-prefs";

interface Prefs {
  view: View;
  showRanks: boolean;
  preset: RangePreset;
  customStart?: string;
  customEnd?: string;
  bucket: Bucket;
  estimated: boolean;
  checkUpdates: boolean;
  /** The version whose banner was closed; a later version shows it again. */
  dismissedUpdate?: string;
}

function loadPrefs(): Prefs {
  const defaults: Prefs = { view: "overview", showRanks: true, preset: "30d", bucket: "daily", estimated: false, checkUpdates: true };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    const saved: Partial<Prefs> = raw && typeof raw === "object" ? raw : {};
    const showRanks = saved.showRanks !== false;
    const requestedView = viewFromHash() ?? (VIEWS.some((v) => v.id === saved.view) ? saved.view! : defaults.view);
    const view = requestedView === "rank" && !showRanks ? "overview" : requestedView;
    const bucket = saved.bucket === "daily" || saved.bucket === "weekly" || saved.bucket === "monthly"
      ? saved.bucket : defaults.bucket;
    const preset: RangePreset = saved.preset === "custom"
      ? "custom"
      : (RANGE_PRESETS.find((option) => option.id === saved.preset)?.id ?? defaults.preset);
    const customDatesValid = isDayKey(saved.customStart) && isDayKey(saved.customEnd)
      && saved.customStart <= saved.customEnd && saved.customEnd <= todayKey();
    return {
      view,
      showRanks,
      bucket,
      preset: preset === "custom" && !customDatesValid ? defaults.preset : preset,
      estimated: saved.estimated === true,
      checkUpdates: saved.checkUpdates !== false,
      ...(typeof saved.dismissedUpdate === "string" ? { dismissedUpdate: saved.dismissedUpdate } : {}),
      ...(customDatesValid ? { customStart: saved.customStart, customEnd: saved.customEnd } : {}),
    };
  } catch {
    return { ...defaults, view: viewFromHash() ?? "overview" };
  }
}

function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = parseDay(value);
  return Number.isFinite(day.getTime()) && localDateKey(day) === value;
}

/** Each view has a linkable #hash, e.g. http://localhost:4269/#projects. */
function viewFromHash(): View | null {
  const id = location.hash.slice(1);
  return VIEWS.some((v) => v.id === id) ? (id as View) : null;
}

export function App() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [startup, setStartup] = useState<StartupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savingStartup, setSavingStartup] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const dashboardRequestId = useRef(0);
  const startupRequestId = useRef(0);
  const activeRefreshId = useRef<number | null>(null);
  const startupMutationInFlight = useRef(false);

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [harness, setHarness] = useState<HarnessFilter>("all");
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState<ThemeMode>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  );
  const [followsSystemTheme, setFollowsSystemTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_MODE_STORAGE_KEY);
      return saved !== "light" && saved !== "dark";
    } catch {
      return true;
    }
  });
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [importedTheme, setImportedTheme] = useState<ImportedTheme | null>(readImportedTheme);

  const updatePrefs = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const updates = useUpdates(prefs.checkUpdates);
  const showUpdateBanner = updates.phase !== "idle" || (prefs.checkUpdates && !!updates.status?.updateAvailable
    && updates.status.latest !== prefs.dismissedUpdate);

  function setShowRanks(showRanks: boolean) {
    setPrefs((p) => ({ ...p, showRanks, view: !showRanks && p.view === "rank" ? "overview" : p.view }));
  }

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* Storage may be disabled. */ }
  }, [prefs]);

  useEffect(() => {
    const hash = prefs.view === "overview" ? "" : `#${prefs.view}`;
    if (location.hash !== hash) history.replaceState(null, "", `${location.pathname}${hash}`);
  }, [prefs.view]);

  useEffect(() => {
    const onHash = () => {
      const requestedView = viewFromHash() ?? "overview";
      const view = requestedView === "rank" && !prefs.showRanks ? "overview" : requestedView;
      if (view !== requestedView) history.replaceState(null, "", location.pathname);
      setPrefs((p) => (p.view === view ? p : { ...p, view }));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [prefs.showRanks]);

  useEffect(() => {
    applyTheme(theme, appearance, importedTheme);
  }, [theme, appearance, importedTheme]);

  useEffect(() => {
    if (!followsSystemTheme) return;
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setTheme(event.matches ? "dark" : "light");
    systemTheme.addEventListener("change", onChange);
    return () => systemTheme.removeEventListener("change", onChange);
  }, [followsSystemTheme]);

  // Only a click stores a theme, so an untouched dashboard keeps following the OS.
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setFollowsSystemTheme(false);
    setTheme(next);
    try { localStorage.setItem(THEME_MODE_STORAGE_KEY, next); } catch { /* Storage may be disabled. */ }
  }

  function changeThemeMode(mode: ThemeMode | "system") {
    if (mode === "system") {
      setFollowsSystemTheme(true);
      setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      try { localStorage.removeItem(THEME_MODE_STORAGE_KEY); } catch { /* Storage may be disabled. */ }
      return;
    }
    setFollowsSystemTheme(false);
    setTheme(mode);
    try { localStorage.setItem(THEME_MODE_STORAGE_KEY, mode); } catch { /* Storage may be disabled. */ }
  }

  function changeAppearance(next: Appearance) {
    const safe = next.imported && !importedTheme ? { ...next, imported: false } : next;
    setAppearance(safe);
    saveAppearance(safe);
  }

  function saveImportedTheme(next: ImportedTheme) {
    setImportedTheme(next);
    changeAppearance({ ...appearance, imported: true });
    try { localStorage.setItem(IMPORTED_THEME_STORAGE_KEY, JSON.stringify(next)); } catch { /* Storage may be disabled. */ }
  }

  async function fetchDashboard(opts?: { refresh?: boolean; forceDeepScan?: boolean }) {
    if (!opts?.refresh && activeRefreshId.current !== null) return;
    const requestId = ++dashboardRequestId.current;
    if (opts?.refresh) activeRefreshId.current = requestId;
    try {
      if (opts?.refresh) setRefreshing(true);
      const q = new URLSearchParams();
      if (opts?.refresh) q.set("refresh", "1");
      if (opts?.forceDeepScan) q.set("deep", "1");
      const res = await fetch(`/api/usage?${q.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as DashboardPayload;
      if (requestId === dashboardRequestId.current) {
        setData(next);
        setError(null);
      }
    } catch (err) {
      if (requestId === dashboardRequestId.current) {
        setError(err instanceof Error ? err.message : "Failed to load ccusage data");
      }
    } finally {
      if (activeRefreshId.current === requestId) activeRefreshId.current = null;
      if (requestId === dashboardRequestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  async function fetchStartup() {
    if (startupMutationInFlight.current) return;
    const requestId = ++startupRequestId.current;
    try {
      const res = await fetch("/api/startup");
      if (!res.ok) throw new Error("Could not load startup settings");
      const next = await res.json();
      if (requestId === startupRequestId.current) {
        setStartup(next);
        setStartupError(null);
      }
    } catch (cause) {
      if (requestId === startupRequestId.current) {
        setStartupError(cause instanceof Error ? cause.message : "Could not load startup settings");
      }
    }
  }

  useEffect(() => {
    void fetchDashboard();
    void fetchStartup();
  }, []);

  // Poll gently while a background deep scan (e.g. Antigravity) is running.
  useEffect(() => {
    if (!data?.syncingHarnesses?.length) return;
    const id = setInterval(() => {
      if (!document.hidden) void fetchDashboard();
    }, 3500);
    return () => clearInterval(id);
  }, [data?.syncingHarnesses?.length]);

  // Cached data on first load triggers a background refresh on the server; pick it up.
  useEffect(() => {
    if (!data || data.syncingHarnesses.length || Date.now() - Date.parse(data.generatedAt) < 30_000) return;
    let checks = 0;
    const id = setInterval(() => {
      if (document.hidden) return;
      if (++checks > 12) { clearInterval(id); return; }
      void fetchDashboard();
    }, 5000);
    return () => clearInterval(id);
  }, [data?.generatedAt, data?.syncingHarnesses.length]);

  async function handleToggleStartup(nextEnabled: boolean, nextOpenBrowser?: boolean) {
    if (!startup || startupMutationInFlight.current) return;
    startupMutationInFlight.current = true;
    const requestId = ++startupRequestId.current;
    setSavingStartup(true);
    setStartupError(null);
    try {
      const res = await fetch("/api/startup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled, openBrowserOnBoot: nextOpenBrowser ?? startup.openBrowserOnBoot }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Could not update startup settings");
      if (requestId === startupRequestId.current) setStartup(result);
    } catch (cause) {
      if (requestId === startupRequestId.current) {
        setStartupError(cause instanceof Error ? cause.message : "Could not update startup settings");
      }
    } finally {
      startupMutationInFlight.current = false;
      setSavingStartup(false);
    }
  }

  async function handleQuit() {
    try {
      await fetch("/api/shutdown", { method: "POST", headers: { "Content-Type": "application/json" } });
    } catch {
      // The server may drop the connection as it exits; it is stopping either way.
    } finally {
      setShowSettings(false);
      setStopped(true);
    }
  }

  const closeSettings = useCallback(() => setShowSettings(false), []);

  const estimated = prefs.estimated;
  const costOf = useCallback(
    (c: { verifiedCost: number; estimatedCost: number }) => (estimated ? c.estimatedCost : c.verifiedCost),
    [estimated]
  );

  const firstDay = data?.daily[0]?.period;
  const range: DateRange = useMemo(() => {
    if (prefs.preset === "custom" && prefs.customStart && prefs.customEnd) {
      return { preset: "custom", start: prefs.customStart, end: prefs.customEnd };
    }
    return presetRange(prefs.preset === "custom" ? "30d" : prefs.preset, firstDay);
  }, [prefs.preset, prefs.customStart, prefs.customEnd, firstDay]);

  // Chart colors follow all-time usage rank (the server sorts harnesses by tokens), so no
  // filter ever repaints a tool; past the validated slots, tools share "Other".
  const { series, seriesOf, nameOf } = useMemo(() => {
    const byId = new Map<HarnessId, SeriesInfo>();
    const names = new Map<HarnessId, string>();
    const list: SeriesInfo[] = [];
    const other: SeriesInfo = { key: "other", name: "Other", color: OTHER_SERIES };
    for (const h of data?.harnesses ?? []) names.set(h.meta.id, h.meta.name);
    (data?.harnesses ?? []).filter((h) => h.meta.hasUsage).forEach((h, i) => {
      if (i < SERIES_SLOTS) {
        const info = { key: h.meta.id, name: h.meta.name, color: seriesColor(i) };
        byId.set(h.meta.id, info);
        list.push(info);
      } else {
        byId.set(h.meta.id, other);
        if (!list.includes(other)) list.push(other);
      }
    });
    return {
      series: list,
      seriesOf: (id: HarnessId) => byId.get(id) ?? other,
      nameOf: (id: HarnessId) => names.get(id) ?? id,
    };
  }, [data]);

  const days = useMemo(
    () => (data ? daysInRange(data.daily, harness, range.start, range.end) : []),
    [data, harness, range.start, range.end]
  );
  const sessions = useMemo(
    () => (data ? sessionsInRange(data.sessions, harness, range.start, range.end) : []),
    [data, harness, range.start, range.end]
  );

  if (stopped) {
    return (
      <div className="splash">
        <div className="splash-card">
          <Power size={30} aria-hidden="true" />
          <h2>Token Larper stopped</h2>
          <p>
            The server and tray icon have shut down. Run <code>bun start</code> or <code>Start-TokenLarper.vbs</code> to
            start it again.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="splash">
        <div className="splash-card">
          <Logo className="splash-logo" />
          <h2>Summoning Token Larper…</h2>
          <p>Reading local usage from your coding tools with ccusage.</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="splash">
        <div className="splash-card">
          <AlertTriangle size={28} aria-hidden="true" />
          <h2>Couldn't load usage</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => void fetchDashboard({ refresh: true, forceDeepScan: true })}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const view = VIEWS.find((v) => v.id === prefs.view && (v.id !== "rank" || prefs.showRanks)) ?? VIEWS[0]!;
  const failed = data.harnesses.filter((h) => h.meta.syncStatus === "error");
  const toolsWithUsage = data.harnesses.filter((h) => h.meta.hasUsage);
  const searchable = view.id === "models" || view.id === "projects" || view.id === "sessions";
  const toolOptions: SelectMenuOption<HarnessFilter>[] = [
    { value: "all", label: "All tools", visual: <span className="tool-filter-dot is-all" aria-hidden="true" /> },
    ...toolsWithUsage.map((h) => ({
      value: h.meta.id,
      label: h.meta.name,
      visual: <span className="tool-filter-dot" aria-hidden="true" style={{ background: seriesOf(h.meta.id).color }} />,
    })),
  ];

  const ctx: Dashboard = {
    data,
    range,
    harness,
    setHarness,
    estimated,
    costOf,
    days,
    sessions,
    series,
    seriesOf,
    nameOf,
    search: searchable ? search : "",
  };

  return (
    <DashboardProvider value={ctx}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <Logo className="brand-logo" />
            <h1>Token Larper</h1>
            {data.syncingHarnesses.length > 0 && (
              <span className="pill">
                <RefreshCw size={12} className="spin" aria-hidden="true" />
                Syncing {data.syncingHarnesses.map(nameOf).join(", ")}
              </span>
            )}
            {failed.length > 0 && (
              <span className="pill pill-warning" title="ccusage failed or timed out for these tools. Showing their last good data.">
                <AlertTriangle size={12} aria-hidden="true" />
                Couldn't refresh {failed.map((h) => h.meta.name).join(", ")}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            {prefs.showRanks && <RankChip tokens={data.totals.totalTokens} active={view.id === "rank"} onOpen={() => updatePrefs({ view: "rank" })} />}
            <span className="updated" title={new Date(data.generatedAt).toLocaleString()}>
              Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <button
              className="icon-btn"
              onClick={toggleTheme}
              title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button
              className="icon-btn"
              onClick={() => {
                setShowSettings(true);
                void fetchStartup();
              }}
              title="Settings"
              aria-label="Settings"
            >
              <Settings size={16} />
            </button>
            <button className="btn" disabled={refreshing} onClick={() => void fetchDashboard({ refresh: true, forceDeepScan: true })} title="Refresh all tools; Antigravity scans in the background">
              <RefreshCw size={15} className={refreshing ? "spin" : ""} aria-hidden="true" />
              <span>{refreshing ? "Scanning…" : "Sync"}</span>
            </button>
          </div>
        </header>

        {showUpdateBanner && (
          <UpdateBanner updates={updates} onDismiss={() => updatePrefs({ dismissedUpdate: updates.status?.latest ?? undefined })} />
        )}

        <nav className="tabs" aria-label="Dashboard views">
          {VIEWS.filter((v) => v.id !== "rank" || prefs.showRanks).map((v) => (
            <button
              key={v.id}
              className="tab"
              aria-current={prefs.view === v.id ? "page" : undefined}
              onClick={() => updatePrefs({ view: v.id })}
            >
              {v.label}
            </button>
          ))}
        </nav>

        {/* The Rank tab's character sheet carries its own heading. */}
        {view.id !== "rank" && (
          <div className="intro">
            <div>
              <span className="eyebrow">Local usage</span>
              <h2>{view.title}</h2>
              <p>{view.blurb}</p>
            </div>
          </div>
        )}

        {error && <div className="inline-error" role="alert">Sync failed: {error}</div>}

        {view.id !== "rank" && (
        <div className="filters">
          <DateRangePicker
            range={range}
            firstDay={firstDay}
            onChange={(r) => updatePrefs({ preset: r.preset, customStart: r.start, customEnd: r.end })}
          />
          <SelectMenu label="Tool" value={harness} options={toolOptions} onChange={setHarness} className="tool-picker" />
          <div className="field cost-field">
            <span className="field-label">Cost</span>
            <div className="cost-segmented" role="group" aria-label="Cost basis">
              <button type="button" aria-pressed={!estimated} onClick={() => updatePrefs({ estimated: false })}>Verified</button>
              <button type="button" aria-pressed={estimated} onClick={() => updatePrefs({ estimated: true })} title="Estimated API value">Estimate</button>
            </div>
          </div>
          {searchable && (
            <label className="field field-search">
              <span className="field-label">Search</span>
              <span className="search">
                <Search size={15} aria-hidden="true" />
                <input type="search" placeholder={`Search ${view.label.toLowerCase()}`} value={search} onChange={(e) => setSearch(e.target.value)} />
              </span>
            </label>
          )}
        </div>
        )}

        <main className="content">
          {view.id === "overview" && <Overview bucket={prefs.bucket} setBucket={(bucket) => updatePrefs({ bucket })} />}
          {view.id === "tools" && <Tools />}
          {view.id === "models" && <Models />}
          {view.id === "projects" && <Projects />}
          {view.id === "sessions" && <Sessions />}
          {view.id === "rank" && <Rank />}
        </main>

        <AppFooter />

        {showSettings && (
          <SettingsDialog
            startup={startup}
            startupError={startupError}
            saving={savingStartup}
            themeMode={theme}
            followsSystemTheme={followsSystemTheme}
            appearance={appearance}
            importedTheme={importedTheme}
            showRanks={prefs.showRanks}
            updates={updates}
            checkUpdates={prefs.checkUpdates}
            onCheckUpdatesChange={(checkUpdates) => updatePrefs({ checkUpdates })}
            onClose={closeSettings}
            onThemeModeChange={changeThemeMode}
            onAppearanceChange={changeAppearance}
            onImportTheme={saveImportedTheme}
            onShowRanksChange={setShowRanks}
            onToggleStartup={(enabled, open) => void handleToggleStartup(enabled, open)}
            onRetry={() => void fetchStartup()}
            onQuit={() => void handleQuit()}
          />
        )}
      </div>
    </DashboardProvider>
  );
}
