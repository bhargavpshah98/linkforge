import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { AnalyticsBody, FilterChips, RangePicker, useAnalyticsParams } from "../components/analytics";
import { StatTile } from "../components/charts";
import { PageHeader } from "../components/Layout";
import { EmptyState, Favicon, PageLoader } from "../components/ui";
import { api, type OverviewReport } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmt, fmtPct } from "../lib/format";

export function Overview() {
  const { user } = useAuth();
  const { rangeId, filters, query, setRange, toggleFilter, clearFilters } = useAnalyticsParams();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["overview", query],
    queryFn: () => api<OverviewReport>(`/analytics/overview?${query}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return <PageLoader />;

  if (data.links.total_links === 0) {
    return (
      <>
        <PageHeader title={`Welcome, ${user?.name.split(" ")[0] ?? ""}`} />
        <EmptyState
          icon={<Link2 size={22} />}
          title="Create your first short link"
          body="Press C or use the Create new button. Analytics will show up here as soon as someone clicks."
        />
      </>
    );
  }

  return (
    <div className={isFetching ? "opacity-90 transition-opacity" : ""}>
      <PageHeader
        title="Overview"
        subtitle="Performance across all of your links. Click any bar to filter."
        actions={<RangePicker value={rangeId} onChange={setRange} />}
      />
      <div className="mb-4">
        <FilterChips filters={filters} onRemove={(k) => toggleFilter(k, null)} onClear={clearFilters} />
      </div>
      <AnalyticsBody
        report={data}
        filters={filters}
        onFilter={toggleFilter}
        extraTiles={<StatTile label="Active links" value={data.links.active_links} hint={`${fmt(data.links.lifetime_clicks)} lifetime clicks`} />}
      />
      <section className="card mt-4 p-5">
        <h3 className="mb-3 text-sm font-semibold">Top performing links</h3>
        {data.top_links.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No clicks in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="pb-2 font-medium">Link</th>
                  <th className="pb-2 text-right font-medium">Clicks</th>
                  <th className="hidden pb-2 text-right font-medium sm:table-cell">Unique</th>
                  <th className="pb-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {data.top_links.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="py-2.5 pr-3">
                      <RouterLink to={`/app/links/${l.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
                        <Favicon url={l.long_url} size={28} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{l.title || l.code}</span>
                          <span className="block truncate text-xs text-muted">/{l.code}</span>
                        </span>
                      </RouterLink>
                    </td>
                    <td className="py-2.5 text-right font-medium">{fmt(l.clicks)}</td>
                    <td className="hidden py-2.5 text-right text-ink-2 sm:table-cell">{fmt(l.unique_visitors)}</td>
                    <td className="py-2.5 text-right text-ink-2">{fmtPct(l.clicks, data.totals.clicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
