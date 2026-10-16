import crypto from "node:crypto";
import { db } from "../db.js";

export const WEBHOOK_EVENTS = ["link.created", "link.updated", "link.deleted", "link.clicked"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

type HookRow = { id: string; url: string; events: string; secret: string };

export function recordDelivery(status: number, hookId: string) {
  return db
    .run("UPDATE webhooks SET last_status = ?, last_delivery_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [status, hookId])
    .catch(() => {});
}

export function sign(secret: string, body: string) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Delivers an event to every matching webhook. Receivers verify `X-LinkForge-Signature` by computing
 * HMAC-SHA256(secret, rawBody). Failures are recorded on the webhook, never thrown.
 */
export async function emit(userId: string, event: WebhookEvent, data: unknown): Promise<void> {
  const rows = await db.all<HookRow>("SELECT id, url, events, secret FROM webhooks WHERE user_id = ? AND is_active = 1", [userId]);
  const hooks = rows.filter((h) => (JSON.parse(h.events) as string[]).includes(event));
  if (!hooks.length) return;
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), data });
  await Promise.all(
    hooks.map((hook) =>
    fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "LinkForge-Webhooks/1.0",
        "x-linkforge-event": event,
        "x-linkforge-signature": sign(hook.secret, body),
      },
      body,
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => recordDelivery(res.status, hook.id))
      .catch(() => recordDelivery(0, hook.id)),
    ),
  );
}
