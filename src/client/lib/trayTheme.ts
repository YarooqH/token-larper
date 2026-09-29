// Keeps the Windows tray popup in the same colors as the dashboard. Themes can use any CSS
// color syntax (oklch, color-mix, …), which the tray can't parse, so each token is painted
// onto a 1×1 canvas and read back as #rrggbb.

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

function toHex(color: string, ctx: CanvasRenderingContext2D): string {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

function readTheme(): Record<string, string> | null {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // A probe element resolves var() chains and color-mix() to a computed color.
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  const out: Record<string, string> = { mode: document.documentElement.dataset.theme === "light" ? "light" : "dark" };
  for (const [key, token] of Object.entries(TOKENS)) {
    probe.style.color = `var(${token})`;
    out[key] = toHex(getComputedStyle(probe).color, ctx);
  }
  probe.remove();
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
    attributeFilter: ["data-theme", "data-palette", "data-style", "data-accent", "style", "class"],
  });
  schedule();
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}
