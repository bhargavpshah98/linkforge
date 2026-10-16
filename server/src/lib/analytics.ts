import { z } from "zod";
import { db } from "../db.js";

export const DIMENSIONS = {
  referrers: "c.referrer_domain",
  countries: "c.country",
  cities: "c.city",
  devices: "c.device",
  browsers: "c.browser",
  os: "c.os",
  sources: "c.source",
} as const;
export type Dimension = keyof typeof DIMENSIONS;

const INTERVAL_FORMAT = {
  hour: "strftime('%Y-%m-%dT%H:00:00Z', c.ts)",
  day: "strftime('%Y-%m-%d', c.ts)",
  week: "date(c.ts, '-' || ((CAST(strftime('%w', c.ts) AS INTEGER) + 6) % 7) || ' days')",
  month: "strftime('%Y-%m-01', c.ts)",
} as const;
export type Interval = keyof typeof INTERVAL_FORMAT;

export const rangeSchema = z.object({
  from: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  to: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  interval: z.enum(["hour", "day", "week", "month"]).optional(),
  include_bots: z.enum(["true", "false"]).optional(),
  tz_offset: z.coerce.number().int().min(-840).max(840).optional(),
  // Drill-down filters: narrow the whole report to one value of a dimension.
  referrer: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  device: z.string().optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  source: z.string().optional(),
});

export const FILTER_COLUMNS = {
  referrer: "c.referrer_domain",
  country: "c.country",
  city: "c.city",
  device: "c.device",
  browser: "c.browser",
  os: "c.os",
  source: "c.source",
} as const;
export type Filters = Partial<Record<keyof typeof FILTER_COLUMNS, string>>;

export interface Scope {
  userId: string;
  linkId?: string;
  from: Date;
  to: Date;
  includeBots: boolean;
  filters?: Filters;
}

const DAY = 86_400_000;

export function resolveRange(q: z.infer<typeof rangeSchema>) {
  const to = q.to ? new Date(q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * DAY);
  const span = to.getTime() - from.getTime();
  const interval: Interval = q.interval ?? (span <= 2 * DAY ? "hour" : span <= 120 * DAY ? "day" : span <= 730 * DAY ? "week" : "month");
  const filters: Filters = {};
  for (const key of Object.keys(FILTER_COLUMNS) as (keyof typeof FILTER_COLUMNS)[]) if (q[key]) filters[key] = q[key];
  return { from, to, interval, includeBots: q.include_bots === "true", filters };
}

function where(scope: Scope) {
  const parts = ["l.user_id = @userId", "c.ts >= @from", "c.ts <= @to"];
  if (scope.linkId) parts.push("l.id = @linkId");
  if (!scope.includeBots) parts.push("c.is_bot = 0");
  const filterParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(scope.filters ?? {})) {
    const column = FILTER_COLUMNS[key as keyof typeof FILTER_COLUMNS];
    if (!column || value == null) continue;
    parts.push(value === "Unknown" ? `(${column} IS NULL OR ${column} = 'Unknown')` : `${column} = @f_${key}`);
    filterParams[`f_${key}`] = value;
  }
  return {
    sql: `FROM clicks c JOIN links l ON l.id = c.link_id WHERE ${parts.join(" AND ")}`,
    params: { userId: scope.userId, linkId: scope.linkId ?? null, from: scope.from.toISOString(), to: scope.to.toISOString(), ...filterParams },
  };
}

export function totals(scope: Scope) {
  const w = where(scope);
  const row = db
    .prepare(`SELECT COUNT(*) AS clicks, COUNT(DISTINCT c.visitor_hash) AS unique_visitors ${w.sql}`)
    .get(w.params) as { clicks: number; unique_visitors: number };
  // Same-length window immediately before, for the "vs previous period" delta.
  const span = scope.to.getTime() - scope.from.getTime();
  const pw = where({ ...scope, from: new Date(scope.from.getTime() - span), to: new Date(scope.from.getTime() - 1) });
  const prev = db.prepare(`SELECT COUNT(*) AS clicks ${pw.sql}`).get(pw.params) as { clicks: number };
  const qr = db.prepare(`SELECT COUNT(*) AS n ${w.sql} AND c.source = 'qr'`).get(w.params) as { n: number };
  return { ...row, qr_scans: qr.n, previous_clicks: prev.clicks };
}

function bucketKeys(from: Date, to: Date, interval: Interval) {
  const keys: string[] = [];
  const d = new Date(from);
  if (interval === "hour") d.setUTCMinutes(0, 0, 0);
  else d.setUTCHours(0, 0, 0, 0);
  if (interval === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (interval === "month") d.setUTCDate(1);
  while (d <= to && keys.length < 5000) {
    const iso = d.toISOString();
    keys.push(interval === "hour" ? iso.slice(0, 13) + ":00:00Z" : iso.slice(0, 10));
    if (interval === "hour") d.setUTCHours(d.getUTCHours() + 1);
    else if (interval === "day") d.setUTCDate(d.getUTCDate() + 1);
    else if (interval === "week") d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return keys;
}

/** Clicks per bucket, zero-filled so charts never have gaps. */
export function timeseries(scope: Scope, interval: Interval) {
  const w = where(scope);
  const rows = db
    .prepare(
      `SELECT ${INTERVAL_FORMAT[interval]} AS bucket, COUNT(*) AS clicks, COUNT(DISTINCT c.visitor_hash) AS unique_visitors
       ${w.sql} GROUP BY bucket`,
    )
    .all(w.params) as { bucket: string; clicks: number; unique_visitors: number }[];
  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  return bucketKeys(scope.from, scope.to, interval).map((key) => ({
    date: key,
    clicks: byKey.get(key)?.clicks ?? 0,
    unique_visitors: byKey.get(key)?.unique_visitors ?? 0,
  }));
}

export function breakdown(scope: Scope, dimension: Dimension, limit = 10) {
  const w = where(scope);
  const column = DIMENSIONS[dimension];
  return db
    .prepare(
      `SELECT COALESCE(${column}, 'Unknown') AS value, COUNT(*) AS clicks, COUNT(DISTINCT c.visitor_hash) AS unique_visitors
       ${w.sql} GROUP BY value ORDER BY clicks DESC LIMIT @limit`,
    )
    .all({ ...w.params, limit }) as { value: string; clicks: number; unique_visitors: number }[];
}

/** 7 x 24 grid of clicks by weekday (0 = Monday) and hour, shifted to the viewer's timezone. */
export function heatmap(scope: Scope, tzOffsetMinutes = 0) {
  const w = where(scope);
  const shift = `'${-tzOffsetMinutes} minutes'`;
  const rows = db
    .prepare(
      `SELECT (CAST(strftime('%w', c.ts, ${shift}) AS INTEGER) + 6) % 7 AS weekday,
              CAST(strftime('%H', c.ts, ${shift}) AS INTEGER) AS hour, COUNT(*) AS clicks
       ${w.sql} GROUP BY weekday, hour`,
    )
    .all(w.params) as { weekday: number; hour: number; clicks: number }[];
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const r of rows) grid[r.weekday][r.hour] = r.clicks;
  return grid;
}

export function topLinks(scope: Scope, limit = 10) {
  const w = where(scope);
  return db
    .prepare(
      `SELECT l.id, l.code, l.title, l.long_url, COUNT(*) AS clicks, COUNT(DISTINCT c.visitor_hash) AS unique_visitors
       ${w.sql} GROUP BY l.id ORDER BY clicks DESC LIMIT @limit`,
    )
    .all({ ...w.params, limit }) as { id: string; code: string; title: string | null; long_url: string; clicks: number; unique_visitors: number }[];
}

export function fullReport(scope: Scope, interval: Interval, tzOffset = 0) {
  return {
    range: { from: scope.from.toISOString(), to: scope.to.toISOString(), interval },
    filters: scope.filters ?? {},
    totals: totals(scope),
    timeseries: timeseries(scope, interval),
    referrers: breakdown(scope, "referrers"),
    countries: breakdown(scope, "countries", 250),
    cities: breakdown(scope, "cities"),
    devices: breakdown(scope, "devices"),
    browsers: breakdown(scope, "browsers"),
    os: breakdown(scope, "os"),
    sources: breakdown(scope, "sources"),
    heatmap: heatmap(scope, tzOffset),
  };
}
