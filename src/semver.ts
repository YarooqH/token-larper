/** Compare x.y.z versions numerically; anything after a "-" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split("-")[0]!.split(".").map((n) => Number(n) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  }
  return 0;
}
