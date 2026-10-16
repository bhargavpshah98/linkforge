import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Download, ExternalLink, Lock, Pencil, QrCode, Smartphone, Tag, Timer } from "lucide-react";
import { useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { AnalyticsBody, FilterChips, RangePicker, useAnalyticsParams } from "../components/analytics";
import { StatTile } from "../components/charts";
import { LinkFormDialog } from "../components/LinkForm";
import { QrDialog } from "../components/QrDialog";
import { CopyButton, Favicon, PageLoader } from "../components/ui";
import { api, download, type Click, type LinkReport, type Pagination } from "../lib/api";
import { countryName, displayShort, flag, fmt, fmtDate, fmtDateTime } from "../lib/format";
import { StatusBadge } from "./Links";

export function LinkDetail() {
  const { id } = useParams();
  const { rangeId, filters, query, setRange, toggleFilter, clearFilters } = useAnalyticsParams();
  const [editing, setEditing] = useState(false);
  const [qr, setQr] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["link", id, query],
    queryFn: () => api<LinkReport>(`/links/${id}/analytics?${query}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  if (error) return <p className="py-20 text-center text-ink-2">This link doesn't exist or was deleted. <RouterLink className="text-accent underline" to="/app/links">Back to links</RouterLink></p>;
  if (isLoading || !data) return <PageLoader />;
  const l = data.link;

  return (
    <>
      <RouterLink to="/app/links" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft size={15} /> Back to links
      </RouterLink>

      <section className="card mb-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <Favicon url={l.long_url} size={48} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">{l.title || l.code}</h1>
            <a href={l.short_url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 font-medium text-accent hover:underline">
              {displayShort(l.short_url)} <ExternalLink size={13} />
            </a>
            <p className="truncate text-sm text-ink-2" title={l.long_url}>
              {l.long_url}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={l.short_url} label="Copy" />
            <button className="btn-ghost" onClick={() => setQr(true)}>
              <QrCode size={15} /> QR
            </button>
            <button className="btn-ghost" onClick={() => setEditing(true)}>
              <Pencil size={15} /> Edit
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-xs text-ink-2">
          <StatusBadge status={l.status} />
          <span className="flex items-center gap-1.5">
            <Calendar size={14} /> Created {fmtDate(l.created_at)}
          </span>
          <span>{l.redirect_type} redirect</span>
          {l.password_protected && (
            <span className="flex items-center gap-1.5">
              <Lock size={13} /> Password protected
            </span>
          )}
          {l.expires_at && (
            <span className="flex items-center gap-1.5">
              <Timer size={13} /> {new Date(l.expires_at) < new Date() ? "Expired" : "Expires"} {fmtDateTime(l.expires_at)}
            </span>
          )}
          {l.max_clicks && (
            <span>
              {fmt(l.total_clicks)} / {fmt(l.max_clicks)} click limit
            </span>
          )}
          {(l.ios_url || l.android_url) && (
            <span className="flex items-center gap-1.5">
              <Smartphone size={13} /> Device targeting
            </span>
          )}
          {l.tags.map((t) => (
            <RouterLink key={t} to={`/app/links?tag=${encodeURIComponent(t)}`} className="chip hover:text-ink">
              <Tag size={11} /> {t}
            </RouterLink>
          ))}
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Engagement</h2>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => download(`/links/${l.id}/clicks.csv`, `${l.code}-clicks.csv`)}>
            <Download size={15} /> Export CSV
          </button>
          <RangePicker value={rangeId} onChange={setRange} />
        </div>
      </div>
      <div className="mb-4">
        <FilterChips filters={filters} onRemove={(k) => toggleFilter(k, null)} onClear={clearFilters} />
      </div>
      <AnalyticsBody report={data} filters={filters} onFilter={toggleFilter} extraTiles={<StatTile label="Lifetime clicks" value={l.total_clicks} hint={`since ${fmtDate(l.created_at)}`} />} />
      <RecentClicks linkId={l.id} />

      <LinkFormDialog open={editing} link={l} onClose={() => setEditing(false)} />
      <QrDialog link={qr ? l : null} onClose={() => setQr(false)} />
    </>
  );
}

function RecentClicks({ linkId }: { linkId: string }) {
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ["link", linkId, "clicks", page],
    queryFn: () => api<{ data: Click[]; pagination: Pagination }>(`/links/${linkId}/clicks?limit=15&page=${page}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  return (
    <section className="card mt-4 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recent clicks</h3>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" /> Live
        </span>
      </div>
      {!data?.data.length ? (
        <p className="py-6 text-center text-sm text-muted">No clicks yet. Share your link!</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium">Location</th>
                <th className="pb-2 font-medium">Referrer</th>
                <th className="pb-2 font-medium">Device</th>
                <th className="pb-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c, i) => (
                <tr key={`${c.ts}-${i}`} className={`border-t border-line ${c.is_bot ? "text-muted" : ""}`}>
                  <td className="tabular whitespace-nowrap py-2 pr-3">{fmtDateTime(c.ts)}</td>
                  <td className="py-2 pr-3">
                    {flag(c.country)} {c.city ? `${c.city}, ` : ""}
                    {countryName(c.country)}
                  </td>
                  <td className="max-w-[180px] truncate py-2 pr-3" title={c.referrer ?? "Direct"}>
                    {c.referrer_domain}
                  </td>
                  <td className="py-2 pr-3">
                    {c.browser} · {c.os}
                    {c.is_bot && <span className="chip ml-2">bot</span>}
                  </td>
                  <td className="py-2">{c.source === "qr" ? "QR" : "Link"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.pagination.pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs">
          <button className="btn-ghost px-2.5 py-1 text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
          <span className="tabular text-muted">{page} / {data.pagination.pages}</span>
          <button className="btn-ghost px-2.5 py-1 text-xs" disabled={page >= data.pagination.pages} onClick={() => setPage(page + 1)}>Older</button>
        </div>
      )}
    </section>
  );
}
