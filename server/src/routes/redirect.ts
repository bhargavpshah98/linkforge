import { Router, type Request, type Response } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { config } from "../config.js";
import { db } from "../db.js";
import { verifyPassword } from "../lib/auth.js";
import { background } from "../lib/background.js";
import { linkStatus, serializeLink, shortUrl, type LinkRow } from "../lib/links.js";
import { describeClick, destinationFor } from "../lib/tracking.js";
import { emit } from "../lib/webhooks.js";

export const redirectRouter = Router();

const findByCode = (code: string) => db.get<LinkRow>("SELECT * FROM links WHERE code = ?", [code]);

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(res: Response, status: number, title: string, body: string) {
  res
    .status(status)
    .type("html")
    .setHeader("cache-control", "no-store")
    .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · LinkForge</title><meta name="robots" content="noindex">
<style>
:root{color-scheme:light dark;--bg:#f9f9f7;--card:#fff;--ink:#0b0b0b;--muted:#52514e;--line:rgba(11,11,11,.1);--accent:#2a78d6}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--card:#1a1a19;--ink:#f0efec;--muted:#c3c2b7;--line:rgba(255,255,255,.1);--accent:#3987e5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px}
h1{font-size:22px;margin:0 0 8px}p{color:var(--muted);margin:0 0 20px;word-break:break-word}
input{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:10px;font:inherit;background:transparent;color:inherit;margin-bottom:12px}
button,.btn{display:inline-block;width:100%;text-align:center;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:600 15px system-ui;cursor:pointer;text-decoration:none}
.err{color:#d03b3b;font-size:14px;margin:-4px 0 12px}.brand{font-weight:700;font-size:14px;color:var(--muted);margin-bottom:24px;letter-spacing:.02em}
code{background:var(--bg);padding:2px 6px;border-radius:6px;font-size:14px}
</style></head><body><main class="card"><div class="brand">🔗 LinkForge</div>${body}</main></body></html>`);
}

function notFoundPage(res: Response) {
  page(res, 404, "Link not found", `<h1>This link doesn't exist</h1><p>Check the address for typos, or ask whoever shared it for a new one.</p><a class="btn" href="${config.appUrl}">Create your own short link</a>`);
}

function unavailablePage(res: Response, status: ReturnType<typeof linkStatus>) {
  const reason = status === "expired" ? "This link has expired." : status === "limit_reached" ? "This link has reached its click limit." : "This link has been disabled by its owner.";
  page(res, 410, "Link unavailable", `<h1>Link unavailable</h1><p>${reason}</p>`);
}

function passwordPage(req: Request, res: Response, code: string, error?: string) {
  const action = `/${encodeURIComponent(code)}${req.query.qr === "1" ? "?qr=1" : ""}`;
  page(
    res,
    error ? 401 : 200,
    "Password required",
    `<h1>This link is protected</h1><p>Enter the password to continue.</p>
     <form method="post" action="${escapeHtml(action)}">
       <input type="password" name="password" placeholder="Password" autofocus required autocomplete="off">
       ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
       <button type="submit">Continue</button>
     </form>`,
  );
}

async function recordAndRedirect(req: Request, res: Response, link: LinkRow) {
  const info = describeClick(req);
  const ts = new Date().toISOString();
  const source = req.query.qr === "1" ? "qr" : "link";
  const click = {
    link_id: link.id,
    ts,
    visitor_hash: info.visitorHash,
    referrer: info.referrer,
    referrer_domain: info.referrerDomain,
    country: info.country,
    city: info.city,
    device: info.device,
    browser: info.browser,
    os: info.os,
    source,
    is_bot: Number(info.isBot),
  };
  await db.batch([
    {
      sql: `INSERT INTO clicks (link_id, ts, visitor_hash, referrer, referrer_domain, country, city, device, browser, os, source, is_bot)
            VALUES (@link_id, @ts, @visitor_hash, @referrer, @referrer_domain, @country, @city, @device, @browser, @os, @source, @is_bot)`,
      args: click,
    },
    // Bots are stored for transparency but don't count toward totals or click limits.
    ...(info.isBot ? [] : [{ sql: "UPDATE links SET total_clicks = total_clicks + 1, last_clicked_at = ? WHERE id = ?", args: [ts, link.id] }]),
  ]);

  if (!info.isBot) {
    background(
      emit(link.user_id, "link.clicked", {
        link: { id: link.id, code: link.code, short_url: shortUrl(link.code), long_url: link.long_url },
        click: { ts, country: info.country, city: info.city, device: info.device, browser: info.browser, os: info.os, referrer: info.referrerDomain, source },
      }),
    );
  }

  // 302s are never cached by browsers, so every visit is counted. 301s may be cached (better for SEO, worse for analytics).
  res.setHeader("cache-control", link.redirect_type === 301 ? "public, max-age=300" : "private, no-store");
  // After the password form (a POST) use 303 so the browser follows with a GET.
  res.redirect(req.method === "POST" ? 303 : link.redirect_type, destinationFor(link, info.os));
}

async function lookup(req: Request) {
  const raw = String(req.params.code);
  const preview = raw.endsWith("+");
  return { preview, link: await findByCode(preview ? raw.slice(0, -1) : raw) };
}

redirectRouter.get("/:code", async (req, res) => {
  const { preview, link } = await lookup(req);
  if (!link) return notFoundPage(res);

  // Like bit.ly: appending "+" shows where a link goes instead of following it.
  if (preview) {
    const l = serializeLink(link);
    return page(
      res,
      200,
      "Link preview",
      `<h1>Link preview</h1><p><code>${escapeHtml(l.short_url)}</code> redirects to:</p>
       <p style="color:var(--ink);font-weight:500">${escapeHtml(link.long_url)}</p>
       <p>${l.total_clicks.toLocaleString()} clicks · created ${new Date(link.created_at).toDateString()}</p>
       ${l.status === "active" && !l.password_protected ? `<a class="btn" href="/${escapeHtml(link.code)}">Continue to site</a>` : ""}`,
    );
  }

  const status = linkStatus(link);
  if (status !== "active") return unavailablePage(res, status);
  if (link.password_hash) return passwordPage(req, res, link.code);
  await recordAndRedirect(req, res, link);
});

const passwordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, skip: () => config.env === "test" });

redirectRouter.post("/:code", passwordLimiter, express.urlencoded({ extended: false }), async (req, res) => {
  const { link } = await lookup(req);
  if (!link) return notFoundPage(res);
  const status = linkStatus(link);
  if (status !== "active") return unavailablePage(res, status);
  if (!link.password_hash) return await recordAndRedirect(req, res, link);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!(await verifyPassword(password, link.password_hash))) return passwordPage(req, res, link.code, "Incorrect password");
  await recordAndRedirect(req, res, link);
});
