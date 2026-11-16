import { waitUntil } from "@vercel/functions";

const pending = new Set<Promise<unknown>>();

/**
 * Runs work after the response is sent (click recording, webhooks, "last used" stamps) without holding
 * up the request. On Vercel the function would otherwise freeze as soon as the response ends, so we
 * register the promise with waitUntil; on a normal long-running server it just runs.
 */
export function background(task: Promise<unknown>) {
  const safe = task.catch((err) => console.error("background task failed:", err));
  pending.add(safe);
  void safe.finally(() => pending.delete(safe));
  if (process.env.VERCEL) waitUntil(safe);
}

/** Resolves once every background task started so far has finished. Used by tests and graceful shutdown. */
export async function settle() {
  while (pending.size) await Promise.all([...pending]);
}
