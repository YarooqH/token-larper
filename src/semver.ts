/**
 * Compare versions by semver precedence: x.y.z numerically, then a prerelease
 * (1.5.0-beta.1) sorts before its release, and prerelease parts compare numerically
 * when both are numbers. Build metadata (+...) isn't used by this package.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): [string, string] => {
    const dash = v.indexOf("-");
    return dash < 0 ? [v, ""] : [v.slice(0, dash), v.slice(dash + 1)];
  };
  const [coreA, preA] = split(a);
  const [coreB, preB] = split(b);
  const parse = (v: string) => v.split(".").map((n) => Number(n) || 0);
  const [x, y] = [parse(coreA), parse(coreB)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  }
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  const [p, q] = [preA.split("."), preB.split(".")];
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    const [m, n] = [p[i], q[i]];
    if (m === undefined) return -1;
    if (n === undefined) return 1;
    if (m === n) continue;
    const [mNum, nNum] = [/^\d+$/.test(m), /^\d+$/.test(n)];
    if (mNum && nNum) return Number(m) > Number(n) ? 1 : -1;
    if (mNum) return -1;
    if (nNum) return 1;
    return m > n ? 1 : -1;
  }
  return 0;
}
