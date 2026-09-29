// Themes can use any CSS color syntax (oklch, color-mix, var() chains). To get a plain
// #rrggbb, a hidden probe element resolves the expression to a computed color, which is
// painted onto a 1×1 canvas and read back.

export interface ColorReader {
  /** Resolve a CSS color expression, e.g. "var(--bg)", to #rrggbb. */
  read(expression: string): string;
  dispose(): void;
}

export function createColorReader(): ColorReader | null {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx || !document.body) return null;
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  return {
    read(expression) {
      probe.style.color = "";
      probe.style.color = expression;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = getComputedStyle(probe).color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
    },
    dispose() {
      probe.remove();
    },
  };
}
