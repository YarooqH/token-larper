export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return Math.round(n).toLocaleString("en-US");
}

/** YYYY-MM-DD for a Date in the local time zone. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ISO-8601 week for a calendar date: weeks start Monday, week 1 holds the year's first Thursday. */
export function isoWeek(year: number, month: number, day: number): { key: string; label: string } {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const isoYear = d.getUTCFullYear();
  return { key: `${isoYear}-W${String(weekNo).padStart(2, "0")}`, label: `Week ${weekNo}, ${isoYear}` };
}

export function formatExactNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

export function formatCurrency(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (n > 0 && n < 0.01 && decimals === 2) {
    return `$${n.toFixed(4)}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function cleanProjectPath(raw: string): string {
  if (!raw) return "Unknown Session";
  // Convert Claude/Pi encoded paths like "F--Just-Some-Files-opensource-twtbk" or "--F--Just Some Files-..."
  let cleaned = raw.replace(/^--+|--+$/g, "");
  if (/^[A-Za-z]--/.test(cleaned)) {
    cleaned = `${cleaned[0]}:/${cleaned.slice(3).replace(/-/g, "/")}`;
  }
  if (cleaned.length > 58) {
    return "..." + cleaned.slice(-55);
  }
  return cleaned;
}
