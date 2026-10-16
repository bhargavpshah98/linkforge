import { waitUntil } from "@vercel/functions";

/**
 * Runs work after the response is sent (webhooks, "last used" stamps) without holding up the request.
 * On Vercel the function would otherwise freeze as soon as the response ends, so we register the
 * promise with waitUntil; on a normal long-running server it just runs.
 */
export function background(task: Promise<unknown>) {
  const safe = task.catch((err) => console.error("background task failed:", err));
  if (process.env.VERCEL) waitUntil(safe);
}
