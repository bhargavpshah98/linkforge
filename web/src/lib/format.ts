const nf = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export const fmt = (n: number) => nf.format(n);
export const fmtCompact = (n: number) => (n < 10_000 ? nf.format(n) : compact.format(n));

export function fmtPct(part: number, whole: number) {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  return new Date(iso).toLocaleDateString(undefined, opts);
}

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const units: [number, string][] = [[60, "minute"], [3600, "hour"], [86400, "day"], [2592000, "month"], [31536000, "year"]];
  let i = units.length - 1;
  while (i > 0 && s < units[i][0]) i--;
  const n = Math.floor(s / units[i][0]);
  return `${n} ${units[i][1]}${n === 1 ? "" : "s"} ago`;
}

/** Labels a timeseries bucket key for axis/tooltip, based on the bucket size. */
export function bucketLabel(key: string, interval: string, long = false) {
  const d = new Date(key.length === 10 ? `${key}T00:00:00Z` : key);
  if (interval === "hour") return d.toLocaleString(undefined, long ? { month: "short", day: "numeric", hour: "numeric" } : { hour: "numeric" });
  if (interval === "month") return d.toLocaleDateString(undefined, { month: "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" });
  const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC", ...(long ? { weekday: "short" } : {}) });
  return interval === "week" && long ? `Week of ${label}` : label;
}

const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(undefined, { type: "region" }) : null;

export function countryName(code: string) {
  if (!code || code === "Unknown" || code.length !== 2) return code || "Unknown";
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function flag(code: string) {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function faviconUrl(url: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=64`;
}

export function displayShort(shortUrl: string) {
  return shortUrl.replace(/^https?:\/\//, "");
}
