import { Router, type Request } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "../db.js";
import { fullReport, rangeSchema, resolveRange, topLinks, type Scope } from "../lib/analytics.js";
import { hashPassword } from "../lib/auth.js";
import { notFound } from "../lib/http.js";
import {
  applyUtm,
  assertCodeAvailable,
  createLink,
  createLinkSchema,
  getLinkById,
  serializeLink,
  shortUrl,
  updateLinkSchema,
  type LinkRow,
} from "../lib/links.js";
import { emit } from "../lib/webhooks.js";

/** Links + analytics. Mounted behind requireAuth. */
export const linksRouter = Router();

function ownedLink(req: Request) {
  const row = getLinkById.get(String(req.params.id), req.user!.id);
  if (!row) throw notFound("Link not found");
  return row;
}

// ---- Collection ----

const listSchema = z.object({
  q: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  status: z.enum(["active", "disabled", "expired", "protected"]).optional(),
  sort: z.enum(["created_desc", "created_asc", "clicks_desc", "clicks_asc", "last_clicked"]).default("created_desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const SORTS = {
  created_desc: "created_at DESC",
  created_asc: "created_at ASC",
  clicks_desc: "total_clicks DESC, created_at DESC",
  clicks_asc: "total_clicks ASC, created_at DESC",
  last_clicked: "last_clicked_at IS NULL, last_clicked_at DESC",
} as const;

linksRouter.get("/links", (req, res) => {
  const q = listSchema.parse(req.query);
  const where = ["user_id = @userId"];
  const params: Record<string, unknown> = { userId: req.user!.id };
  if (q.q) {
    where.push("(code LIKE @q OR long_url LIKE @q OR title LIKE @q)");
    params.q = `%${q.q}%`;
  }
  if (q.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(links.tags) WHERE value = @tag)");
    params.tag = q.tag;
  }
  const now = new Date().toISOString();
  if (q.status === "active") where.push(`is_active = 1 AND (expires_at IS NULL OR expires_at > '${now}') AND (max_clicks IS NULL OR total_clicks < max_clicks)`);
  if (q.status === "disabled") where.push("is_active = 0");
  if (q.status === "expired") where.push(`(expires_at <= '${now}' OR total_clicks >= max_clicks)`);
  if (q.status === "protected") where.push("password_hash IS NOT NULL");

  const clause = where.join(" AND ");
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM links WHERE ${clause}`).get(params) as { total: number };
  const rows = db
    .prepare(`SELECT * FROM links WHERE ${clause} ORDER BY ${SORTS[q.sort]} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: q.limit, offset: (q.page - 1) * q.limit }) as LinkRow[];

  // 14-day sparkline per link in one query.
  const ids = rows.map((r) => r.id);
  const spark = new Map<string, number[]>();
  if (ids.length) {
    const since = new Date(Date.now() - 13 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const pts = db
      .prepare(
        `SELECT link_id, CAST(julianday(substr(ts, 1, 10)) - julianday(@since) AS INTEGER) AS d, COUNT(*) AS n FROM clicks
         WHERE link_id IN (${ids.map(() => "?").join(",")}) AND ts >= @sinceIso AND is_bot = 0 GROUP BY link_id, d`,
      )
      .all(...ids, { since: since.toISOString().slice(0, 10), sinceIso: since.toISOString() }) as { link_id: string; d: number; n: number }[];
    for (const p of pts) {
      const arr = spark.get(p.link_id) ?? Array(14).fill(0);
      if (p.d >= 0 && p.d < 14) arr[p.d] = p.n;
      spark.set(p.link_id, arr);
    }
  }

  res.json({
    data: rows.map((r) => ({ ...serializeLink(r), sparkline: spark.get(r.id) ?? Array(14).fill(0) })),
    pagination: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
  });
});

linksRouter.post("/links", async (req, res) => {
  const input = createLinkSchema.parse(req.body);
  const link = serializeLink(await createLink(req.user!.id, input));
  emit(req.user!.id, "link.created", link);
  res.status(201).json(link);
});

linksRouter.post("/links/bulk", async (req, res) => {
  const { links } = z.object({ links: z.array(z.unknown()).min(1).max(500) }).parse(req.body);
  const results = [];
  for (const [index, raw] of links.entries()) {
    const parsed = createLinkSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ index, ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
      continue;
    }
    try {
      const link = serializeLink(await createLink(req.user!.id, parsed.data));
      emit(req.user!.id, "link.created", link);
      results.push({ index, ok: true, link });
    } catch (err) {
      results.push({ index, ok: false, error: err instanceof Error ? err.message : "Failed" });
    }
  }
  res.status(207).json({ created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
});

linksRouter.get("/tags", (req, res) => {
  const rows = db
    .prepare(
      `SELECT j.value AS tag, COUNT(*) AS links FROM links, json_each(links.tags) j WHERE links.user_id = ? GROUP BY j.value ORDER BY links DESC, tag`,
    )
    .all(req.user!.id);
  res.json({ data: rows });
});

// ---- Single link ----

linksRouter.get("/links/:id", (req, res) => {
  res.json(serializeLink(ownedLink(req)));
});

linksRouter.patch("/links/:id", async (req, res) => {
  const link = ownedLink(req);
  const body = updateLinkSchema.parse(req.body);
  if (body.code && body.code !== link.code) assertCodeAvailable(body.code, link.id);

  const next: Partial<LinkRow> = {};
  if (body.url !== undefined) next.long_url = applyUtm(body.url, body.utm);
  else if (body.utm) next.long_url = applyUtm(link.long_url, body.utm);
  if (body.code !== undefined) next.code = body.code;
  if (body.title !== undefined) next.title = body.title || null;
  if (body.tags !== undefined) next.tags = JSON.stringify([...new Set(body.tags)]);
  if (body.password !== undefined) next.password_hash = body.password ? await hashPassword(body.password) : null;
  if (body.expires_at !== undefined) next.expires_at = body.expires_at ?? null;
  if (body.max_clicks !== undefined) next.max_clicks = body.max_clicks ?? null;
  if (body.redirect_type !== undefined) next.redirect_type = body.redirect_type;
  if (body.ios_url !== undefined) next.ios_url = body.ios_url ?? null;
  if (body.android_url !== undefined) next.android_url = body.android_url ?? null;
  if (body.is_active !== undefined) next.is_active = Number(body.is_active);

  const keys = Object.keys(next);
  if (keys.length) {
    db.prepare(
      `UPDATE links SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`,
    ).run({ ...next, id: link.id });
  }
  const updated = serializeLink(getLinkById.get(link.id, req.user!.id)!);
  emit(req.user!.id, "link.updated", updated);
  res.json(updated);
});

linksRouter.delete("/links/:id", (req, res) => {
  const link = ownedLink(req);
  db.prepare("DELETE FROM links WHERE id = ?").run(link.id);
  emit(req.user!.id, "link.deleted", { id: link.id, code: link.code });
  res.status(204).end();
});

linksRouter.get("/links/:id/qr", async (req, res) => {
  const link = ownedLink(req);
  const q = z
    .object({
      format: z.enum(["png", "svg"]).default("png"),
      size: z.coerce.number().int().min(64).max(2048).default(512),
      color: z.string().regex(/^[0-9a-fA-F]{6}$/).default("111827"),
      bg: z.string().regex(/^[0-9a-fA-F]{6}$/).default("ffffff"),
      download: z.enum(["1", "0"]).optional(),
    })
    .parse(req.query);
  // `?qr=1` lets the redirect handler attribute scans separately from link clicks.
  const target = `${shortUrl(link.code)}?qr=1`;
  const opts = { margin: 2, width: q.size, color: { dark: `#${q.color}`, light: `#${q.bg}` }, errorCorrectionLevel: "M" as const };
  if (q.download === "1") res.setHeader("content-disposition", `attachment; filename="${link.code}-qr.${q.format}"`);
  if (q.format === "svg") {
    res.type("image/svg+xml").send(await QRCode.toString(target, { ...opts, type: "svg" }));
  } else {
    res.type("image/png").send(await QRCode.toBuffer(target, opts));
  }
});

// ---- Analytics ----

function scopeFrom(req: Request, linkId?: string) {
  const q = rangeSchema.parse(req.query);
  const r = resolveRange(q);
  const scope: Scope = { userId: req.user!.id, linkId, from: r.from, to: r.to, includeBots: r.includeBots, filters: r.filters };
  return { scope, interval: r.interval, tzOffset: q.tz_offset ?? 0 };
}

linksRouter.get("/links/:id/analytics", (req, res) => {
  const link = ownedLink(req);
  const { scope, interval, tzOffset } = scopeFrom(req, link.id);
  res.json({ link: serializeLink(link), ...fullReport(scope, interval, tzOffset) });
});

const CLICK_COLUMNS = "ts, referrer, referrer_domain, country, city, device, browser, os, source, is_bot";

linksRouter.get("/links/:id/clicks", (req, res) => {
  const link = ownedLink(req);
  const q = z
    .object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(500).default(50) })
    .parse(req.query);
  const { total } = db.prepare("SELECT COUNT(*) AS total FROM clicks WHERE link_id = ?").get(link.id) as { total: number };
  const rows = db
    .prepare(`SELECT ${CLICK_COLUMNS} FROM clicks WHERE link_id = ? ORDER BY ts DESC LIMIT ? OFFSET ?`)
    .all(link.id, q.limit, (q.page - 1) * q.limit) as Record<string, unknown>[];
  res.json({
    data: rows.map((r) => ({ ...r, is_bot: Boolean(r.is_bot) })),
    pagination: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
  });
});

linksRouter.get("/links/:id/clicks.csv", (req, res) => {
  const link = ownedLink(req);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.type("text/csv").setHeader("content-disposition", `attachment; filename="${link.code}-clicks.csv"`);
  res.write(CLICK_COLUMNS + "\n");
  const stmt = db.prepare(`SELECT ${CLICK_COLUMNS} FROM clicks WHERE link_id = ? ORDER BY ts DESC`);
  for (const row of stmt.iterate(link.id) as Iterable<Record<string, unknown>>) {
    res.write(Object.values(row).map(esc).join(",") + "\n");
  }
  res.end();
});

linksRouter.get("/analytics/overview", (req, res) => {
  const { scope, interval, tzOffset } = scopeFrom(req);
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total_links, SUM(is_active) AS active_links, COALESCE(SUM(total_clicks), 0) AS lifetime_clicks FROM links WHERE user_id = ?`,
    )
    .get(req.user!.id);
  res.json({ links: counts, ...fullReport(scope, interval, tzOffset), top_links: topLinks(scope, 10) });
});
