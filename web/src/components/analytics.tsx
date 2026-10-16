import { Calendar, Check, ChevronDown, X } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { FilterKey, Filters, Report } from "../lib/api";
import { countryName, flag, fmt } from "../lib/format";
import { BarList, ClicksChart, Heatmap, SplitBar, StatTile } from "./charts";
import { useClickOutside } from "./ui";

// ---------- Range + filters live in the URL so views are shareable and survive reloads ----------

export const RANGES = [
  { id: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { id: "30d", label: "Last 30 days", ms: 30 * 86_400_000 },
  { id: "90d", label: "Last 90 days", ms: 90 * 86_400_000 },
  { id: "365d", label: "Last 12 months", ms: 365 * 86_400_000 },
] as const;

const FILTER_KEYS: FilterKey[] = ["referrer", "country", "city", "device", "browser", "os", "source"];

export function useAnalyticsParams() {
  const [params, setParams] = useSearchParams();
  const rangeId = params.get("range") ?? "30d";
  const filters: Filters = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) filters[k] = v;
  }

  const query = useMemo(() => {
    const q = new URLSearchParams();
    const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[2];
    // Round "now" to the minute so the query key is stable across re-renders.
    const to = new Date(Math.ceil(Date.now() / 60_000) * 60_000);
    q.set("from", new Date(to.getTime() - range.ms).toISOString());
    q.set("to", to.toISOString());
    q.set("tz_offset", String(new Date().getTimezoneOffset()));
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) q.set(k, v);
    }
    return q.toString();
  }, [rangeId, params]);

  const setRange = useCallback(
    (id: string) =>
      setParams((p) => {
        p.set("range", id);
        return p;
      }),
    [setParams],
  );
  const toggleFilter = useCallback(
    (key: FilterKey, value: string | null) =>
      setParams((p) => {
        if (value === null || p.get(key) === value) p.delete(key);
        else p.set(key, value);
        return p;
      }),
    [setParams],
  );
  const clearFilters = useCallback(
    () =>
      setParams((p) => {
        FILTER_KEYS.forEach((k) => p.delete(k));
        return p;
      }),
    [setParams],
  );
  return { rangeId, filters, query, setRange, toggleFilter, clearFilters };
}

export function RangePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const current = RANGES.find((r) => r.id === value) ?? RANGES[2];
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Calendar size={15} /> {current.label} <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <ul className="card absolute right-0 z-30 mt-1 w-52 p-1 shadow-xl" role="listbox">
          {RANGES.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={r.id === value}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  onChange(r.id);
                  setOpen(false);
                }}
              >
                <span className={r.id === value ? "font-semibold" : ""}>{r.label}</span>
                {r.id === value && <Check size={16} strokeWidth={3} className="text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FILTER_LABEL: Record<FilterKey, string> = {
  referrer: "Referrer",
  country: "Country",
  city: "City",
  device: "Device",
  browser: "Browser",
  os: "OS",
  source: "Source",
};

export function FilterChips({ filters, onRemove, onClear }: { filters: Filters; onRemove: (k: FilterKey) => void; onClear: () => void }) {
  const entries = Object.entries(filters) as [FilterKey, string][];
  if (!entries.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">Filtered by</span>
      {entries.map(([k, v]) => (
        <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft py-1 pl-3 pr-1.5 text-xs text-ink">
          <span className="text-ink-2">{FILTER_LABEL[k]}:</span>
          <span className="font-medium">{k === "country" ? `${flag(v)} ${countryName(v)}` : labelFor(k, v)}</span>
          <button type="button" className="rounded-full p-0.5 hover:bg-surface" onClick={() => onRemove(k)} aria-label={`Remove ${FILTER_LABEL[k]} filter`}>
            <X size={12} />
          </button>
        </span>
      ))}
      <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}

function labelFor(k: FilterKey, v: string) {
  if (k === "device") return v[0].toUpperCase() + v.slice(1);
  if (k === "source") return v === "qr" ? "QR code" : "Link";
  return v;
}

// ---------- The full analytics body shared by Overview and Link detail ----------

function Panel({ title, children, tabs, action }: { title: string; children: ReactNode; tabs?: ReactNode; action?: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {tabs}
        {action}
      </div>
      {children}
    </section>
  );
}

function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="flex rounded-lg bg-surface-2 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${value === o.id ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AnalyticsBody({
  report,
  filters,
  onFilter,
  extraTiles,
}: {
  report: Report;
  filters: Filters;
  onFilter: (key: FilterKey, value: string) => void;
  extraTiles?: ReactNode;
}) {
  const [geoTab, setGeoTab] = useState<"countries" | "cities">("countries");
  const [techTab, setTechTab] = useState<"browsers" | "os">("browsers");
  const t = report.totals;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total clicks" value={t.clicks} delta={{ current: t.clicks, previous: t.previous_clicks }} />
        <StatTile label="Unique visitors" value={t.unique_visitors} hint={t.clicks ? `${(t.clicks / Math.max(1, t.unique_visitors)).toFixed(1)} clicks per visitor` : undefined} />
        <StatTile label="QR code scans" value={t.qr_scans} hint={t.clicks ? `${Math.round((t.qr_scans / t.clicks) * 100)}% of clicks` : undefined} />
        {extraTiles}
      </div>

      <Panel title="Clicks over time">
        <ClicksChart data={report.timeseries} interval={report.range.interval} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top referrers">
          <BarList heading="Referrer" rows={report.referrers} label={(v) => v} onSelect={(v) => onFilter("referrer", v)} active={filters.referrer} />
        </Panel>
        <Panel
          title="Locations"
          tabs={
            <Tabs
              value={geoTab}
              onChange={setGeoTab}
              options={[
                { id: "countries", label: "Countries" },
                { id: "cities", label: "Cities" },
              ]}
            />
          }
        >
          {geoTab === "countries" ? (
            <BarList
              heading="Country"
              rows={report.countries}
              label={(v) => (
                <>
                  <span aria-hidden>{flag(v)}</span> {countryName(v)}
                </>
              )}
              onSelect={(v) => onFilter("country", v)}
              active={filters.country}
            />
          ) : (
            <BarList heading="City" rows={report.cities} label={(v) => v} onSelect={(v) => onFilter("city", v)} active={filters.city} />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Devices">
          <SplitBar
            rows={report.devices}
            order={["desktop", "mobile", "tablet"]}
            label={(v) => v[0].toUpperCase() + v.slice(1)}
            onSelect={(v) => onFilter("device", v)}
            active={filters.device}
          />
        </Panel>
        <Panel
          title="Technology"
          tabs={
            <Tabs
              value={techTab}
              onChange={setTechTab}
              options={[
                { id: "browsers", label: "Browsers" },
                { id: "os", label: "OS" },
              ]}
            />
          }
        >
          {techTab === "browsers" ? (
            <BarList heading="Browser" rows={report.browsers} label={(v) => v} onSelect={(v) => onFilter("browser", v)} active={filters.browser} limit={6} />
          ) : (
            <BarList heading="Operating system" rows={report.os} label={(v) => v} onSelect={(v) => onFilter("os", v)} active={filters.os} limit={6} />
          )}
        </Panel>
        <Panel title="Link vs. QR code">
          <SplitBar
            rows={report.sources}
            order={["link", "qr"]}
            label={(v) => (v === "qr" ? "QR code scans" : "Link clicks")}
            onSelect={(v) => onFilter("source", v)}
            active={filters.source}
          />
        </Panel>
      </div>

      <Panel title="When people click" action={<span className="text-xs text-muted">Your local time · {fmt(t.clicks)} clicks</span>}>
        <Heatmap grid={report.heatmap} />
      </Panel>
    </div>
  );
}
