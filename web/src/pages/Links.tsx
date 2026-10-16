import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Calendar, Lock, MoreHorizontal, Pencil, Power, QrCode, Search, Tag, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { Sparkline } from "../components/charts";
import { PageHeader } from "../components/Layout";
import { LinkFormDialog } from "../components/LinkForm";
import { QrDialog } from "../components/QrDialog";
import { CopyButton, EmptyState, Favicon, Modal, PageLoader, useClickOutside, useToast } from "../components/ui";
import { api, type Link, type Pagination } from "../lib/api";
import { displayShort, fmt, fmtDate, hostOf, timeAgo } from "../lib/format";

const STATUS_STYLE: Record<Link["status"], string> = {
  active: "text-good",
  disabled: "text-muted",
  expired: "text-bad",
  limit_reached: "text-warn",
};
const STATUS_LABEL: Record<Link["status"], string> = { active: "Active", disabled: "Disabled", expired: "Expired", limit_reached: "Limit reached" };

export function StatusBadge({ status }: { status: Link["status"] }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Links() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search);
  const tag = params.get("tag") ?? "";
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "created_desc";
  const page = Number(params.get("page") ?? 1);
  const [editing, setEditing] = useState<Link | null>(null);
  const [qr, setQr] = useState<Link | null>(null);
  const [bulk, setBulk] = useState(false);

  const update = (k: string, v: string) =>
    setParams((p) => {
      if (v) p.set(k, v);
      else p.delete(k);
      if (k !== "page") p.delete("page");
      return p;
    });

  useEffect(() => {
    if ((params.get("q") ?? "") !== q) update("q", q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const qs = new URLSearchParams({ sort, page: String(page), limit: "20", ...(q && { q }), ...(tag && { tag }), ...(status && { status }) }).toString();
  const { data, isLoading } = useQuery({
    queryKey: ["links", qs],
    queryFn: () => api<{ data: Link[]; pagination: Pagination }>(`/links?${qs}`),
    placeholderData: keepPreviousData,
  });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api<{ data: { tag: string; links: number }[] }>("/tags") });

  const filtered = Boolean(q || tag || status);

  return (
    <>
      <PageHeader
        title="Links"
        subtitle={data ? `${fmt(data.pagination.total)} ${filtered ? "matching" : "total"} links` : undefined}
        actions={
          <button className="btn-ghost" onClick={() => setBulk(true)}>
            <Upload size={15} /> Bulk create
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search by title, back-half or destination" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search links" />
        </div>
        <select className="input w-auto" value={tag} onChange={(e) => update("tag", e.target.value)} aria-label="Filter by tag">
          <option value="">All tags</option>
          {tags.data?.data.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.links})
            </option>
          ))}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => update("status", e.target.value)} aria-label="Filter by status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="expired">Expired / limit reached</option>
          <option value="protected">Password protected</option>
        </select>
        <select className="input w-auto" value={sort} onChange={(e) => update("sort", e.target.value)} aria-label="Sort">
          <option value="created_desc">Newest first</option>
          <option value="created_asc">Oldest first</option>
          <option value="clicks_desc">Most clicks</option>
          <option value="clicks_asc">Fewest clicks</option>
          <option value="last_clicked">Recently clicked</option>
        </select>
      </div>

      {isLoading || !data ? (
        <PageLoader />
      ) : data.data.length === 0 ? (
        <EmptyState
          icon={<Search size={22} />}
          title={filtered ? "No links match" : "No links yet"}
          body={filtered ? "Try a different search or clear the filters." : "Press C to create your first short link."}
        />
      ) : (
        <ul className="space-y-3">
          {data.data.map((l) => (
            <LinkRow key={l.id} link={l} onEdit={() => setEditing(l)} onQr={() => setQr(l)} onTag={(t) => update("tag", t)} />
          ))}
        </ul>
      )}

      {data && data.pagination.pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2 text-sm">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => update("page", String(page - 1))}>
            Previous
          </button>
          <span className="tabular px-2 text-ink-2">
            Page {page} of {data.pagination.pages}
          </span>
          <button className="btn-ghost" disabled={page >= data.pagination.pages} onClick={() => update("page", String(page + 1))}>
            Next
          </button>
        </div>
      )}

      <LinkFormDialog open={Boolean(editing)} link={editing ?? undefined} onClose={() => setEditing(null)} />
      <QrDialog link={qr} onClose={() => setQr(null)} />
      <BulkDialog open={bulk} onClose={() => setBulk(false)} />
    </>
  );
}

function LinkRow({ link: l, onEdit, onQr, onTag }: { link: Link; onEdit: () => void; onQr: () => void; onTag: (t: string) => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setMenu(false));
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["links"] });
    qc.invalidateQueries({ queryKey: ["overview"] });
    qc.invalidateQueries({ queryKey: ["tags"] });
  };
  const toggle = useMutation({
    mutationFn: () => api(`/links/${l.id}`, { method: "PATCH", json: { is_active: !l.is_active } }),
    onSuccess: () => (refresh(), toast(l.is_active ? "Link disabled" : "Link enabled")),
  });
  const remove = useMutation({
    mutationFn: () => api(`/links/${l.id}`, { method: "DELETE" }),
    onSuccess: () => (refresh(), toast("Link deleted")),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <li className="card flex gap-4 p-4 transition-shadow hover:shadow-md sm:p-5">
      <div className="hidden sm:block">
        <Favicon url={l.long_url} size={40} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <RouterLink to={`/app/links/${l.id}`} className="min-w-0 hover:underline">
            <h3 className="truncate font-semibold">{l.title || hostOf(l.long_url)}</h3>
          </RouterLink>
          <div className="flex shrink-0 items-center gap-1.5">
            <CopyButton text={l.short_url} label="Copy" className="btn-ghost px-2.5 py-1.5 text-xs" />
            <button className="btn-ghost px-2 py-1.5" onClick={onQr} aria-label="QR code">
              <QrCode size={15} />
            </button>
            <div className="relative" ref={ref}>
              <button className="btn-ghost px-2 py-1.5" onClick={() => setMenu((m) => !m)} aria-label="More actions" aria-expanded={menu}>
                <MoreHorizontal size={15} />
              </button>
              {menu && (
                <div className="card absolute right-0 z-20 mt-1 w-44 p-1 text-sm shadow-xl">
                  <MenuItem icon={<Pencil size={14} />} label="Edit" onClick={() => (setMenu(false), onEdit())} />
                  <MenuItem icon={<BarChart3 size={14} />} label="View analytics" to={`/app/links/${l.id}`} />
                  <MenuItem icon={<Power size={14} />} label={l.is_active ? "Disable" : "Enable"} onClick={() => (setMenu(false), toggle.mutate())} />
                  <MenuItem icon={<Trash2 size={14} />} label="Delete" danger onClick={() => (setMenu(false), setConfirmDelete(true))} />
                </div>
              )}
            </div>
          </div>
        </div>
        <a href={l.short_url} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-sm font-medium text-accent hover:underline">
          {displayShort(l.short_url)}
        </a>
        <p className="truncate text-sm text-ink-2" title={l.long_url}>
          {l.long_url}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-2">
          <RouterLink to={`/app/links/${l.id}`} className="flex items-center gap-2 hover:text-ink" title="Clicks, last 14 days">
            <BarChart3 size={14} />
            <span className="tabular font-medium text-ink">{fmt(l.total_clicks)}</span> clicks
            {l.sparkline && <Sparkline values={l.sparkline} width={72} height={20} />}
          </RouterLink>
          <span className="flex items-center gap-1.5">
            <Calendar size={14} /> {fmtDate(l.created_at)}
          </span>
          <StatusBadge status={l.status} />
          {l.password_protected && (
            <span className="flex items-center gap-1">
              <Lock size={13} /> Protected
            </span>
          )}
          {l.last_clicked_at && <span className="hidden md:inline">Last click {timeAgo(l.last_clicked_at)}</span>}
          {l.tags.map((t) => (
            <button key={t} className="chip hover:text-ink" onClick={() => onTag(t)}>
              <Tag size={11} /> {t}
            </button>
          ))}
        </div>
      </div>
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete link?" width="max-w-sm">
        <p className="text-sm text-ink-2">
          <b className="text-ink">{displayShort(l.short_url)}</b> will stop working immediately and its {fmt(l.total_clicks)} clicks of history will be deleted. This can't be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button className="btn bg-bad text-white hover:brightness-110" onClick={() => (setConfirmDelete(false), remove.mutate())}>
            Delete link
          </button>
        </div>
      </Modal>
    </li>
  );
}

function MenuItem({ icon, label, onClick, to, danger }: { icon: React.ReactNode; label: string; onClick?: () => void; to?: string; danger?: boolean }) {
  const cls = `flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left hover:bg-surface-2 ${danger ? "text-bad" : "text-ink"}`;
  return to ? (
    <RouterLink to={to} className={cls}>
      {icon} {label}
    </RouterLink>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {icon} {label}
    </button>
  );
}

function BulkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const [failures, setFailures] = useState<{ line: string; error: string }[]>([]);
  const run = useMutation({
    mutationFn: async () => {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      const raw = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const links = raw.map((line) => {
        const [url, title] = line.split(/\s*,\s*(.*)/s);
        return { url: /^https?:\/\//i.test(url) ? url : `https://${url}`, title: title || undefined, tags: tagList };
      });
      const res = await api<{ created: number; failed: number; results: { index: number; ok: boolean; error?: string }[] }>("/links/bulk", { method: "POST", json: { links } });
      return { ...res, raw };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      toast(`Created ${r.created} link${r.created === 1 ? "" : "s"}${r.failed ? `, ${r.failed} failed` : ""}`, r.failed ? "error" : "default");
      // Keep only the lines that failed so a retry never duplicates the ones that worked.
      const failed = r.results.filter((x) => !x.ok).map((x) => ({ line: r.raw[x.index], error: x.error ?? "Failed" }));
      setFailures(failed);
      setText(failed.map((f) => f.line).join("\n"));
      if (!failed.length) onClose();
    },
  });
  const lines = text.split(/\n+/).filter((l) => l.trim()).length;
  return (
    <Modal open={open} onClose={onClose} title="Bulk create links">
      <p className="mb-3 text-sm text-ink-2">One URL per line, optionally followed by a comma and a title. Up to 500 at once.</p>
      <textarea
        className="input h-48 font-mono text-xs"
        placeholder={"https://example.com/page-one, Page one\nhttps://example.com/page-two"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <label className="label mt-3" htmlFor="bulk-tags">Tags for all links</label>
      <input id="bulk-tags" className="input" placeholder="import, q4" value={tags} onChange={(e) => setTags(e.target.value)} />
      {failures.length > 0 && (
        <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-lg bg-bad/10 p-3 text-xs text-bad">
          {failures.map((f, i) => (
            <li key={i} className="break-all">
              <b>{f.line}</b>: {f.error}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex justify-end">
        <button className="btn-primary" disabled={!lines || lines > 500 || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Creating…" : `Create ${lines || ""} link${lines === 1 ? "" : "s"}`}
        </button>
      </div>
    </Modal>
  );
}
