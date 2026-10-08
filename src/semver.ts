/**
 * Compare semver versions: x.y.z numerically, then prerelease tags, so
 * 1.5.0-beta.1 < 1.5.0-beta.2 < 1.5.0. Build metadata after a "+" is ignored.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const plain = v.split("+")[0]!;
    const dash = plain.indexOf("-");
    const core = dash < 0 ? plain : plain.slice(0, dash);
    return { core: core.split(".").map((n) => Number(n) || 0), pre: dash < 0 ? [] : plain.slice(dash + 1).split(".") };
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x.core[i] ?? 0) !== (y.core[i] ?? 0)) return (x.core[i] ?? 0) > (y.core[i] ?? 0) ? 1 : -1;
  }
  // A release outranks its own prereleases.
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === q) continue;
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    // Numeric identifiers compare as numbers and rank below text ones.
    if (pn && qn) return Number(p) > Number(q) ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1;
    return p > q ? 1 : -1;
  }
  return 0;
}
