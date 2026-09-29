// The Burning t.: one-color logo on a transparent background. Every surface draws it
// from these paths (the dashboard inline, the favicon SVG, the share card, and the tray
// icon via flattenPath), so they can't drift apart. 64×64 units.

export const LOGO_VIEWBOX = "0 0 64 64";

export const LOGO_PATHS = {
  t: "M20 7h10v12h13v10H30v14c0 2 1 3 3 3h4v10h-6c-7 0-11-4-11-11V29H10V19h10z",
  // The flame and its hollow core are one even-odd shape.
  flame:
    "M50 34c1 5 8 8 8 15c0 4.418-3.582 8-8 8c-4.418 0-8-3.582-8-8c0-4 2-6.5 4-8.5c.3 2.6 1.4 4.3 3.2 5c-1.2-4.6-.2-8.3.8-11.5z" +
    "M50 44.5c.5 2 3 3.5 3 6c0 1.657-1.343 3-3 3c-1.657 0-3-1.343-3-3c0-1.8 1.5-3.5 3-6z",
};

/** The logo as SVG markup in one fill color. */
export function logoPaths(fill: string): string {
  return `<path d="${LOGO_PATHS.t}" fill="${fill}"/><path d="${LOGO_PATHS.flame}" fill="${fill}" fill-rule="evenodd"/>`;
}

/**
 * A standalone SVG file. The favicon has no page theme to read, so it follows the OS:
 * black on light, white on dark.
 */
export function logoSvgFile(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}" role="img" aria-labelledby="title">
  <title id="title">Token Larper</title>
  <style>path { fill: #141414 } @media (prefers-color-scheme: dark) { path { fill: #f5f5f5 } }</style>
  <path d="${LOGO_PATHS.t}"/>
  <path d="${LOGO_PATHS.flame}" fill-rule="evenodd"/>
</svg>
`;
}

/**
 * Flatten an SVG path (M, L, H, V, C and Z, absolute or relative) into polygons of
 * [x, y] points, sampling each cubic curve. The tray draws these with GDI+, which has
 * no SVG parser; filling them even-odd reproduces the flame's hollow core.
 */
export function flattenPath(d: string, curveSteps = 10): [number, number][][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const polygons: [number, number][][] = [];
  let current: [number, number][] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  const isCommand = (t: string | undefined) => t !== undefined && /[a-zA-Z]/.test(t);

  while (i < tokens.length) {
    if (isCommand(tokens[i])) command = tokens[i++]!;
    const rel = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M": {
        if (current.length) polygons.push(current);
        x = (rel ? x : 0) + num();
        y = (rel ? y : 0) + num();
        [startX, startY] = [x, y];
        current = [[x, y]];
        command = rel ? "l" : "L"; // Further pairs after M are line-tos.
        break;
      }
      case "L":
        x = (rel ? x : 0) + num();
        y = (rel ? y : 0) + num();
        current.push([x, y]);
        break;
      case "H":
        x = (rel ? x : 0) + num();
        current.push([x, y]);
        break;
      case "V":
        y = (rel ? y : 0) + num();
        current.push([x, y]);
        break;
      case "C": {
        const [ox, oy] = rel ? [x, y] : [0, 0];
        const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), ex = ox + num(), ey = oy + num();
        for (let s = 1; s <= curveSteps; s++) {
          const t = s / curveSteps;
          const u = 1 - t;
          current.push([
            u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey,
          ]);
        }
        [x, y] = [ex, ey];
        break;
      }
      case "Z":
        [x, y] = [startX, startY];
        if (current.length) polygons.push(current);
        current = [];
        break;
      default:
        throw new Error(`Unsupported path command "${command}" in logo path`);
    }
  }
  if (current.length) polygons.push(current);
  return polygons;
}
