import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { generateApiKey, requireSession } from "../lib/auth.js";
import { newId } from "../lib/codes.js";
import { notFound } from "../lib/http.js";
import { WEBHOOK_EVENTS, sign } from "../lib/webhooks.js";

/** API keys and webhooks. Mounted behind requireAuth. */
export const developerRouter = Router();

// ---- API keys (managed from the dashboard only, so a leaked key can't mint more keys) ----

developerRouter.get("/api-keys", requireSession, (req, res) => {
  const keys = db
    .prepare("SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC")
    .all(req.user!.id);
  res.json({ data: keys });
});

developerRouter.post("/api-keys", requireSession, (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const { key, prefix, hash } = generateApiKey();
  const id = newId();
  db.prepare("INSERT INTO api_keys (id, user_id, name, prefix, key_hash) VALUES (?, ?, ?, ?, ?)").run(id, req.user!.id, name, prefix, hash);
  const row = db.prepare("SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE id = ?").get(id) as object;
  res.status(201).json({ ...row, key });
});

developerRouter.delete("/api-keys/:id", requireSession, (req, res) => {
  const result = db.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (!result.changes) throw notFound("API key not found");
  res.status(204).end();
});

// ---- Webhooks ----

const webhookSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).default(["link.clicked"]),
  is_active: z.boolean().optional(),
});

type HookRow = { id: string; url: string; events: string; secret: string; is_active: number; last_status: number | null; last_delivery_at: string | null; created_at: string };
const serializeHook = (h: HookRow) => ({ ...h, events: JSON.parse(h.events) as string[], is_active: Boolean(h.is_active) });
const getHook = db.prepare<[string, string], HookRow>("SELECT * FROM webhooks WHERE id = ? AND user_id = ?");

developerRouter.get("/webhooks", (req, res) => {
  const rows = db.prepare("SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC").all(req.user!.id) as HookRow[];
  res.json({ data: rows.map(serializeHook) });
});

developerRouter.post("/webhooks", (req, res) => {
  const body = webhookSchema.parse(req.body);
  const id = newId();
  const secret = "whsec_" + crypto.randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO webhooks (id, user_id, url, events, secret) VALUES (?, ?, ?, ?, ?)").run(
    id,
    req.user!.id,
    body.url,
    JSON.stringify(body.events),
    secret,
  );
  res.status(201).json(serializeHook(getHook.get(id, req.user!.id)!));
});

developerRouter.patch("/webhooks/:id", (req, res) => {
  const hook = getHook.get(req.params.id, req.user!.id);
  if (!hook) throw notFound("Webhook not found");
  const body = webhookSchema.partial().parse(req.body);
  db.prepare("UPDATE webhooks SET url = ?, events = ?, is_active = ? WHERE id = ?").run(
    body.url ?? hook.url,
    body.events ? JSON.stringify(body.events) : hook.events,
    body.is_active === undefined ? hook.is_active : Number(body.is_active),
    hook.id,
  );
  res.json(serializeHook(getHook.get(hook.id, req.user!.id)!));
});

developerRouter.delete("/webhooks/:id", (req, res) => {
  const result = db.prepare("DELETE FROM webhooks WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (!result.changes) throw notFound("Webhook not found");
  res.status(204).end();
});

developerRouter.post("/webhooks/:id/test", async (req, res) => {
  const hook = getHook.get(req.params.id, req.user!.id);
  if (!hook) throw notFound("Webhook not found");
  const body = JSON.stringify({ event: "webhook.test", created_at: new Date().toISOString(), data: { message: "Hello from LinkForge" } });
  let status = 0;
  try {
    const r = await fetch(hook.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-linkforge-event": "webhook.test", "x-linkforge-signature": sign(hook.secret, body) },
      body,
      signal: AbortSignal.timeout(5000),
    });
    status = r.status;
  } catch {
    status = 0;
  }
  db.prepare("UPDATE webhooks SET last_status = ?, last_delivery_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, hook.id);
  res.json({ delivered: status >= 200 && status < 300, status });
});
