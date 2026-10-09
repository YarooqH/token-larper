// Color math for the in-page picker. Colors are edited in OKLCH, where equal slider steps
// look like equal changes in hue, colorfulness and brightness, then stored as #rrggbb.

/** Hue in degrees, vibrance and lightness as 0-100. */
export interface Lch {
  h: number;
  /** Share of the most colorful sRGB color that exists at this hue and lightness. */
  v: number;
  l: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** "#abc", "abc", "#aabbcc" or "aabbcc" to "#aabbcc"; null for anything else. */
export function normalizeHex(input: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match) return null;
  const digits = match[1]!.toLowerCase();
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits}`;
}

type Rgb = [number, number, number];

const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** OKLab to linear sRGB, unclamped. */
function oklabToLinear(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(L: number, C: number, hueRad: number): boolean {
  const eps = 1e-5;
  return oklabToLinear(L, C * Math.cos(hueRad), C * Math.sin(hueRad)).every((c) => c >= -eps && c <= 1 + eps);
}

/** Largest chroma that still fits in sRGB at this lightness (0-1) and hue (degrees). */
export function maxChroma(L: number, hue: number): number {
  if (L <= 0 || L >= 1) return 0;
  const rad = (hue * Math.PI) / 180;
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(L, mid, rad)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function lchToHex({ h, v, l }: Lch): string {
  const L = clamp(l, 0, 100) / 100;
  const C = (clamp(v, 0, 100) / 100) * maxChroma(L, h);
  const rad = (h * Math.PI) / 180;
  const rgb = oklabToLinear(L, C * Math.cos(rad), C * Math.sin(rad));
  return `#${rgb.map((c) => Math.round(clamp(encode(clamp(c, 0, 1)), 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** `keepHue` is used for grays, which have no hue of their own. */
export function hexToLch(hex: string, keepHue = 0): Lch {
  const value = normalizeHex(hex) ?? "#000000";
  const [r, g, b] = [1, 3, 5].map((i) => decode(parseInt(value.slice(i, i + 2), 16) / 255)) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  if (C < 0.004) return { h: keepHue, v: 0, l: clamp(L * 100, 0, 100) };
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  const max = maxChroma(L, h);
  return { h, v: max > 0 ? clamp((C / max) * 100, 0, 100) : 0, l: clamp(L * 100, 0, 100) };
}

/** Delays `fn` until `ms` after the last push, so it runs when the user pauses. */
export function debounce<T>(fn: (value: T) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | null = null;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    fn(value);
  };
  return {
    push(value: T) {
      pending = { value };
      clearTimeout(timer);
      timer = setTimeout(flush, ms);
    },
    /** Send the newest value now, if one is waiting. */
    flush,
  };
}
