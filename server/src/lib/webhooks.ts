import crypto from "node:crypto";
import { db } from "../db.js";

export const WEBHOOK_EVENTS = ["link.created", "link.updated", "link.deleted", "link.clicked"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

type HookRow = { id: string; url: string; events: string; secret: string };

const activeHooks = db.prepare<[string], HookRow>(
  "SELECT id, url, events, secret FROM webhooks WHERE user_id = ? AND is_active = 1",
);
const recordDelivery = db.prepare(
  "UPDATE webhooks SET last_status = ?, last_delivery_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
);

export function sign(secret: string, body: string) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Fire-and-forget delivery. Receivers verify `X-LinkForge-Signature` by computing
 * HMAC-SHA256(secret, rawBody). Failures are recorded on the webhook, never thrown.
 */
export function emit(userId: string, event: WebhookEvent, data: unknown) {
  const hooks = activeHooks.all(userId).filter((h) => (JSON.parse(h.events) as string[]).includes(event));
  if (!hooks.length) return;
  const body = JSON.stringify({ event, created_at: new Date().toISOString(), data });
  for (const hook of hooks) {
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
      .then((res) => recordDelivery.run(res.status, hook.id))
      .catch(() => recordDelivery.run(0, hook.id));
  }
}
