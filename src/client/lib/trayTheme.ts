// Keeps the Windows tray popup in the same colors as the dashboard. The tray only
// understands #rrggbb, so each token is resolved to hex first.

import { createColorReader } from "./cssColor.ts";

const TOKENS = {
  surface: "--surface",
  text: "--text",
  text2: "--text-2",
  text3: "--text-3",
  border: "--border",
  accent: "--accent",
  accentInk: "--accent-ink",
  gold: "--gold",
} as const;

function readTheme(): Record<string, string> | null {
  const reader = createColorReader();
  if (!reader) return null;
  const out: Record<string, string> = { mode: document.documentElement.dataset.theme === "light" ? "light" : "dark" };
  for (const [key, token] of Object.entries(TOKENS)) out[key] = reader.read(`var(${token})`);
  reader.dispose();
  return out;
}

export function startTrayThemeSync(): () => void {
  let last = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const send = () => {
    const theme = readTheme();
    if (!theme) return;
    const body = JSON.stringify(theme);
    if (body === last) return;
    last = body;
    void fetch("/api/ui-theme", { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {
      last = ""; // Retry on the next change if the server was briefly unavailable.
    });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(send, 250);
  };

  const observer = new MutationObserver(schedule);
  // data-palette is today's theme switch; data-style and data-accent come with style presets.
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-palette", "data-style", "data-accent", "data-base", "style", "class"],
  });
  schedule();
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}
