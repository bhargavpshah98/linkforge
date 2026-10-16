import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, KeyRound, Plus, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/Layout";
import { CopyButton, Modal, Toggle, useToast } from "../components/ui";
import { api, ApiError, type ApiKey, type Webhook } from "../lib/api";
import { fmtDate, timeAgo } from "../lib/format";

const EVENTS = ["link.clicked", "link.created", "link.updated", "link.deleted"];

export function Developers() {
  const origin = window.location.origin;
  const [lang, setLang] = useState<"curl" | "js" | "python">("curl");
  const snippets = {
    curl: `curl -X POST ${origin}/api/v1/links \\
  -H "Authorization: Bearer $LINKFORGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/some/long/page", "tags": ["api"]}'`,
    js: `import { LinkForge } from "@linkforge/sdk";

const lf = new LinkForge({ apiKey: process.env.LINKFORGE_API_KEY, baseUrl: "${origin}" });

const link = await lf.links.create({ url: "https://example.com/some/long/page" });
console.log(link.short_url);

const stats = await lf.links.analytics(link.id, { from: "2026-01-01" });
console.log(stats.totals.clicks);`,
    python: `import os, requests

r = requests.post(
    "${origin}/api/v1/links",
    headers={"Authorization": f"Bearer {os.environ['LINKFORGE_API_KEY']}"},
    json={"url": "https://example.com/some/long/page"},
)
print(r.json()["short_url"])`,
  };

  return (
    <>
      <PageHeader
        title="Developers"
        subtitle="Use the REST API to create links and read analytics from your own apps."
        actions={
          <a className="btn-ghost" href="/api/docs" target="_blank" rel="noreferrer">
            <BookOpen size={15} /> API reference
          </a>
        }
      />
      <section className="card mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Quick start</h2>
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {(["curl", "js", "python"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${lang === l ? "bg-surface text-ink shadow-sm" : "text-ink-2"}`}>
                {{ curl: "cURL", js: "TypeScript SDK", python: "Python" }[l]}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 font-mono text-xs leading-relaxed text-ink">{snippets[lang]}</pre>
          <div className="absolute right-2 top-2">
            <CopyButton text={snippets[lang]} className="btn-ghost px-2 py-1" />
          </div>
        </div>
      </section>
      <ApiKeys />
      <Webhooks />
    </>
  );
}

function ApiKeys() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<ApiKey | null>(null);
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api<{ data: ApiKey[] }>("/api-keys") });
  const create = useMutation({
    mutationFn: () => api<ApiKey>("/api-keys", { method: "POST", json: { name: name.trim() || "Untitled key" } }),
    onSuccess: (k) => {
      setCreated(k);
      setName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["api-keys"] }), toast("API key revoked")),
  });

  return (
    <section className="card mb-6 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound size={16} /> API keys
      </h2>
      <p className="mt-1 text-sm text-ink-2">Keys have full access to your links. Keep them server-side and never commit them.</p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <input className="input" placeholder="Key name, e.g. Production server" value={name} onChange={(e) => setName(e.target.value)} aria-label="Key name" />
        <button className="btn-primary shrink-0" disabled={create.isPending}>
          <Plus size={15} /> Create key
        </button>
      </form>
      <ul className="mt-4 divide-y divide-line">
        {keys.data?.data.map((k) => (
          <li key={k.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{k.name}</div>
              <div className="text-xs text-muted">
                <code className="font-mono">{k.prefix}…</code> · created {fmtDate(k.created_at)} · last used {timeAgo(k.last_used_at)}
              </div>
            </div>
            <button className="btn-danger px-2.5 py-1.5 text-xs" onClick={() => revoke.mutate(k.id)}>
              Revoke
            </button>
          </li>
        ))}
        {keys.data?.data.length === 0 && <li className="py-4 text-center text-sm text-muted">No API keys yet.</li>}
      </ul>
      <Modal open={Boolean(created)} onClose={() => setCreated(null)} title="Your new API key" width="max-w-md">
        <p className="text-sm text-ink-2">Copy it now — for your security it won't be shown again.</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 p-3">
          <code className="flex-1 break-all font-mono text-xs">{created?.key}</code>
          <CopyButton text={created?.key ?? ""} className="btn-ghost px-2 py-1" />
        </div>
        <div className="mt-5 flex justify-end">
          <button className="btn-primary" onClick={() => setCreated(null)}>Done</button>
        </div>
      </Modal>
    </section>
  );
}

function Webhooks() {
  const qc = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["link.clicked"]);
  const [error, setError] = useState<string | null>(null);
  const hooks = useQuery({ queryKey: ["webhooks"], queryFn: () => api<{ data: Webhook[] }>("/webhooks") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["webhooks"] });
  const create = useMutation({
    mutationFn: () => api<Webhook>("/webhooks", { method: "POST", json: { url, events } }),
    onSuccess: () => (setUrl(""), setError(null), refresh(), toast("Webhook added")),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Failed"),
  });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => api(`/webhooks/${id}`, { method: "PATCH", json: body }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/webhooks/${id}`, { method: "DELETE" }), onSuccess: () => (refresh(), toast("Webhook deleted")) });
  const test = useMutation({
    mutationFn: (id: string) => api<{ delivered: boolean; status: number }>(`/webhooks/${id}/test`, { method: "POST" }),
    onSuccess: (r) => (refresh(), toast(r.delivered ? `Delivered (HTTP ${r.status})` : `Delivery failed${r.status ? ` (HTTP ${r.status})` : ""}`, r.delivered ? "default" : "error")),
  });

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <WebhookIcon size={16} /> Webhooks
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        We'll POST JSON to your URL. Verify the <code className="font-mono text-xs">X-LinkForge-Signature</code> header (HMAC-SHA256 of the body with the secret).
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="flex gap-2">
          <input className="input" type="url" required placeholder="https://your-app.com/webhooks/linkforge" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Webhook URL" />
          <button className="btn-primary shrink-0" disabled={!events.length || create.isPending}>
            <Plus size={15} /> Add
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents((s) => (e.target.checked ? [...s, ev] : s.filter((x) => x !== ev)))} />
              <code className="font-mono">{ev}</code>
            </label>
          ))}
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>
      <ul className="mt-4 divide-y divide-line">
        {hooks.data?.data.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-3 py-3">
            <Toggle checked={h.is_active} onChange={(v) => patch.mutate({ id: h.id, body: { is_active: v } })} label="Enabled" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs text-ink">{h.url}</div>
              <div className="mt-0.5 text-xs text-muted">
                {h.events.join(", ")} · last delivery{" "}
                {h.last_delivery_at ? (
                  <span className={h.last_status && h.last_status < 300 ? "text-good" : "text-bad"}>
                    {h.last_status || "failed"} {timeAgo(h.last_delivery_at)}
                  </span>
                ) : (
                  "never"
                )}
              </div>
              <div className="mt-1 flex items-center gap-1 text-xs text-muted">
                Secret: <code className="font-mono">{h.secret.slice(0, 12)}…</code>
                <CopyButton text={h.secret} className="rounded p-0.5 hover:text-ink" label={undefined} />
              </div>
            </div>
            <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => test.mutate(h.id)} disabled={test.isPending}>
              <Send size={13} /> Test
            </button>
            <button className="btn-danger px-2 py-1.5" onClick={() => remove.mutate(h.id)} aria-label="Delete webhook">
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {hooks.data?.data.length === 0 && <li className="py-4 text-center text-sm text-muted">No webhooks yet.</li>}
      </ul>
    </section>
  );
}
