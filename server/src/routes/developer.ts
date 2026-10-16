import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { generateApiKey, requireSession } from "../lib/auth.js";
import { newId } from "../lib/codes.js";
import { notFound } from "../lib/http.js";
import { WEBHOOK_EVENTS, recordDelivery, sign } from "../lib/webhooks.js";

/** API keys and webhooks. Mounted behind requireAuth. */
export const developerRouter = Router();

// ---- API keys (managed from the dashboard only, so a leaked key can't mint more keys) ----

developerRouter.get("/api-keys", requireSession, async (req, res) => {
  const keys = await db.all("SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC", [req.user!.id]);
  res.json({ data: keys });
});

developerRouter.post("/api-keys", requireSession, async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const { key, prefix, hash } = generateApiKey();
  const id = newId();
  await db.run("INSERT INTO api_keys (id, user_id, name, prefix, key_hash) VALUES (?, ?, ?, ?, ?)", [id, req.user!.id, name, prefix, hash]);
  const row = await db.get<object>("SELECT id, name, prefix, last_used_at, created_at FROM api_keys WHERE id = ?", [id]);
  res.status(201).json({ ...row, key });
});

developerRouter.delete("/api-keys/:id", requireSession, async (req, res) => {
  const result = await db.run("DELETE FROM api_keys WHERE id = ? AND user_id = ?", [String(req.params.id), req.user!.id]);
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
const getHook = (id: string, userId: string) => db.get<HookRow>("SELECT * FROM webhooks WHERE id = ? AND user_id = ?", [id, userId]);

developerRouter.get("/webhooks", async (req, res) => {
  const rows = await db.all<HookRow>("SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC", [req.user!.id]);
  res.json({ data: rows.map(serializeHook) });
});

developerRouter.post("/webhooks", async (req, res) => {
  const body = webhookSchema.parse(req.body);
  const id = newId();
  const secret = "whsec_" + crypto.randomBytes(24).toString("base64url");
  await db.run("INSERT INTO webhooks (id, user_id, url, events, secret) VALUES (?, ?, ?, ?, ?)", [
    id,
    req.user!.id,
    body.url,
    JSON.stringify(body.events),
    secret,
  ]);
  res.status(201).json(serializeHook((await getHook(id, req.user!.id))!));
});

developerRouter.patch("/webhooks/:id", async (req, res) => {
  const hook = await getHook(String(req.params.id), req.user!.id);
  if (!hook) throw notFound("Webhook not found");
  const body = webhookSchema.partial().parse(req.body);
  await db.run("UPDATE webhooks SET url = ?, events = ?, is_active = ? WHERE id = ?", [
    body.url ?? hook.url,
    body.events ? JSON.stringify(body.events) : hook.events,
    body.is_active === undefined ? hook.is_active : Number(body.is_active),
    hook.id,
  ]);
  res.json(serializeHook((await getHook(hook.id, req.user!.id))!));
});

developerRouter.delete("/webhooks/:id", async (req, res) => {
  const result = await db.run("DELETE FROM webhooks WHERE id = ? AND user_id = ?", [String(req.params.id), req.user!.id]);
  if (!result.changes) throw notFound("Webhook not found");
  res.status(204).end();
});

developerRouter.post("/webhooks/:id/test", async (req, res) => {
  const hook = await getHook(String(req.params.id), req.user!.id);
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
  await recordDelivery(status, hook.id);
  res.json({ delivered: status >= 200 && status < 300, status });
});
