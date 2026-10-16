import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Lock, Megaphone, Smartphone, Timer } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, type Link } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Modal, Toggle, useToast } from "./ui";

interface FormState {
  url: string;
  code: string;
  title: string;
  tags: string;
  password: string;
  removePassword: boolean;
  expires_at: string;
  max_clicks: string;
  redirect_type: 301 | 302;
  ios_url: string;
  android_url: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
}

function initial(link?: Link): FormState {
  return {
    url: link?.long_url ?? "",
    code: link?.code ?? "",
    title: link?.title ?? "",
    tags: link?.tags.join(", ") ?? "",
    password: "",
    removePassword: false,
    expires_at: link?.expires_at ? toLocalInput(link.expires_at) : "",
    max_clicks: link?.max_clicks ? String(link.max_clicks) : "",
    redirect_type: link?.redirect_type ?? 302,
    ios_url: link?.ios_url ?? "",
    android_url: link?.android_url ?? "",
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    utm_term: "",
    utm_content: "",
  };
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function Section({ icon, title, hint, children, defaultOpen }: { icon: ReactNode; title: string; hint: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded-lg border border-line">
      <button type="button" className="flex w-full items-center gap-3 px-3.5 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="text-ink-2">{icon}</span>
        <span className="flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <ChevronDown size={16} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-3 border-t border-line px-3.5 py-3.5">{children}</div>}
    </div>
  );
}

export function LinkFormDialog({ open, onClose, link, onSaved }: { open: boolean; onClose: () => void; link?: Link; onSaved?: (l: Link) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={link ? "Edit link" : "Create a short link"} width="max-w-xl">
      {/* Remount on open so the form always starts from the current link. */}
      {open && <LinkForm link={link} onDone={(l) => (onSaved?.(l), onClose())} />}
    </Modal>
  );
}

function LinkForm({ link, onDone }: { link?: Link; onDone: (l: Link) => void }) {
  const [f, setF] = useState<FormState>(() => initial(link));
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const { shortDomain } = useAuth();
  const origin = `${shortDomain}/`;

  const save = useMutation({
    mutationFn: async () => {
      const utm = Object.fromEntries(
        (["source", "medium", "campaign", "term", "content"] as const).map((k) => [k, f[`utm_${k}`].trim()]).filter(([, v]) => v),
      );
      let url = f.url.trim();
      if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      const body: Record<string, unknown> = {
        url,
        title: f.title.trim() || (link ? null : undefined),
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        expires_at: f.expires_at ? new Date(f.expires_at).toISOString() : link ? null : undefined,
        max_clicks: f.max_clicks ? Number(f.max_clicks) : link ? null : undefined,
        redirect_type: f.redirect_type,
        ios_url: f.ios_url.trim() || (link ? null : undefined),
        android_url: f.android_url.trim() || (link ? null : undefined),
        utm: Object.keys(utm).length ? utm : undefined,
      };
      if (link) {
        if (f.code.trim() && f.code.trim() !== link.code) body.code = f.code.trim();
        if (f.removePassword) body.password = null;
        else if (f.password) body.password = f.password;
        return api<Link>(`/links/${link.id}`, { method: "PATCH", json: body });
      }
      if (f.code.trim()) body.custom_code = f.code.trim();
      if (f.password) body.password = f.password;
      return api<Link>("/links", { method: "POST", json: body });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["link", saved.id] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      if (!link) navigator.clipboard?.writeText(saved.short_url).catch(() => {});
      toast(link ? "Link updated" : "Link created and copied to clipboard");
      onDone(saved);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Something went wrong"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label" htmlFor="lf-url">Destination URL</label>
        <input id="lf-url" className="input" placeholder="https://example.com/my-long-url" value={f.url} onChange={(e) => set("url", e.target.value)} required autoFocus={!link} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="lf-code">Custom back-half <span className="font-normal text-muted">(optional)</span></label>
          <div className="flex overflow-hidden rounded-lg border border-line focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
            <span className="flex items-center bg-surface-2 px-2.5 text-xs text-muted">{origin.replace(/^https?:\/\//, "")}</span>
            <input id="lf-code" className="w-full min-w-0 bg-surface px-2.5 py-2 text-sm outline-none" placeholder="spring-sale" value={f.code} onChange={(e) => set("code", e.target.value)} pattern="[A-Za-z0-9_\-]{3,64}" title="3-64 letters, numbers, - or _" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="lf-title">Title <span className="font-normal text-muted">(optional)</span></label>
          <input id="lf-title" className="input" placeholder="Spring campaign" value={f.title} onChange={(e) => set("title", e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="lf-tags">Tags <span className="font-normal text-muted">(comma separated)</span></label>
        <input id="lf-tags" className="input" placeholder="marketing, social" value={f.tags} onChange={(e) => set("tags", e.target.value)} />
      </div>

      <div className="space-y-2">
        <Section icon={<Megaphone size={16} />} title="UTM parameters" hint="Tag the destination for Google Analytics & co.">
          <div className="grid gap-3 sm:grid-cols-2">
            {(["source", "medium", "campaign", "term", "content"] as const).map((k) => (
              <div key={k}>
                <label className="label" htmlFor={`utm-${k}`}>utm_{k}</label>
                <input id={`utm-${k}`} className="input" placeholder={{ source: "newsletter", medium: "email", campaign: "spring_sale", term: "running shoes", content: "hero_cta" }[k]} value={f[`utm_${k}`]} onChange={(e) => set(`utm_${k}`, e.target.value)} />
              </div>
            ))}
          </div>
        </Section>

        <Section icon={<Lock size={16} />} title="Password protection" hint={link?.password_protected ? "This link is currently protected" : "Visitors must enter a password"} defaultOpen={link?.password_protected}>
          {link?.password_protected && (
            <label className="flex items-center gap-2 text-sm">
              <Toggle checked={f.removePassword} onChange={(v) => set("removePassword", v)} label="Remove password" /> Remove password
            </label>
          )}
          {!f.removePassword && (
            <input type="password" className="input" placeholder={link?.password_protected ? "Enter a new password to change it" : "Password"} value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
          )}
        </Section>

        <Section icon={<Timer size={16} />} title="Expiration & limits" hint="Stop the link after a date or a number of clicks" defaultOpen={Boolean(link?.expires_at || link?.max_clicks)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="lf-exp">Expires at</label>
              <input id="lf-exp" type="datetime-local" className="input" value={f.expires_at} onChange={(e) => set("expires_at", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="lf-max">Click limit</label>
              <input id="lf-max" type="number" min={1} className="input" placeholder="Unlimited" value={f.max_clicks} onChange={(e) => set("max_clicks", e.target.value)} />
            </div>
          </div>
          <div>
            <span className="label">Redirect type</span>
            <div className="flex gap-2">
              {([302, 301] as const).map((t) => (
                <button key={t} type="button" onClick={() => set("redirect_type", t)} className={`flex-1 rounded-lg border px-3 py-2 text-left text-xs ${f.redirect_type === t ? "border-accent bg-accent-soft" : "border-line"}`}>
                  <span className="block text-sm font-medium">{t} {t === 302 ? "Temporary" : "Permanent"}</span>
                  <span className="text-muted">{t === 302 ? "Every click is tracked (recommended)" : "Better for SEO, browsers may cache it"}</span>
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section icon={<Smartphone size={16} />} title="Device targeting" hint="Send iOS and Android visitors somewhere else" defaultOpen={Boolean(link?.ios_url || link?.android_url)}>
          <div>
            <label className="label" htmlFor="lf-ios">iOS destination</label>
            <input id="lf-ios" className="input" placeholder="https://apps.apple.com/app/..." value={f.ios_url} onChange={(e) => set("ios_url", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="lf-android">Android destination</label>
            <input id="lf-android" className="input" placeholder="https://play.google.com/store/apps/..." value={f.android_url} onChange={(e) => set("android_url", e.target.value)} />
          </div>
        </Section>
      </div>

      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : link ? "Save changes" : "Create link"}
        </button>
      </div>
    </form>
  );
}
