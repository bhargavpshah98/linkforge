import { ArrowDownRight, ArrowUpRight, Filter } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Breakdown } from "../lib/api";
import { bucketLabel, fmt, fmtCompact, fmtPct } from "../lib/format";

// ---------- Stat tile ----------

export function StatTile({ label, value, delta, hint }: { label: string; value: number | string; delta?: { current: number; previous: number }; hint?: string }) {
  let deltaEl: ReactNode = null;
  if (delta) {
    if (delta.previous === 0) {
      deltaEl = <span className="text-xs text-muted">{delta.current ? "new this period" : "no change"}</span>;
    } else {
      const pct = ((delta.current - delta.previous) / delta.previous) * 100;
      const up = pct >= 0;
      deltaEl = (
        <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-good" : "text-bad"}`}>
          {up ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}
          {up ? "Up" : "Down"} {Math.abs(pct) > 999 ? ">999" : Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
          <span className="font-normal text-muted">&nbsp;vs previous period</span>
        </span>
      );
    }
  }
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight">{typeof value === "number" ? fmt(value) : value}</div>
      <div className="mt-1 min-h-4">{deltaEl ?? (hint && <span className="text-xs text-muted">{hint}</span>)}</div>
    </div>
  );
}

// ---------- Clicks over time ----------

type Point = { date: string; clicks: number; unique_visitors: number };

function TimeTooltip({ active, payload, interval }: { active?: boolean; payload?: { payload: Point }[]; interval: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-medium text-ink">{bucketLabel(p.date, interval, true)}</div>
      <Row color="var(--s1)" label="Clicks" value={p.clicks} />
      <Row color="var(--s2)" label="Unique visitors" value={p.unique_visitors} line />
    </div>
  );
}

function Row({ color, label, value, line }: { color: string; label: string; value: number; line?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={line ? "h-0.5 w-3 rounded" : "h-2.5 w-2.5 rounded-sm"} style={{ background: color }} />
      <span className="text-ink-2">{label}</span>
      <span className="tabular ml-auto pl-4 font-medium text-ink">{fmt(value)}</span>
    </div>
  );
}

export function ClicksChart({ data, interval, height = 280 }: { data: Point[]; interval: string; height?: number }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const total = data.reduce((s, p) => s + p.clicks, 0);
  const series = [
    { key: "clicks", label: "Clicks", color: "var(--s1)" },
    { key: "unique_visitors", label: "Unique visitors", color: "var(--s2)" },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4" role="group" aria-label="Toggle series">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))}
            className={`inline-flex items-center gap-2 text-xs ${hidden[s.key] ? "text-muted line-through" : "text-ink-2"}`}
            aria-pressed={!hidden[s.key]}
          >
            <span className={s.key === "clicks" ? "h-2.5 w-2.5 rounded-sm" : "h-0.5 w-3.5 rounded"} style={{ background: s.color, opacity: hidden[s.key] ? 0.35 : 1 }} />
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ height }} role="img" aria-label={`Clicks over time, ${fmt(total)} total`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--s1)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--s1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => bucketLabel(v, interval)}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              allowDecimals={false}
              tickFormatter={(v: number) => fmtCompact(v)}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip content={<TimeTooltip interval={interval} />} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
            {!hidden.clicks && (
              <Area
                type="monotone"
                dataKey="clicks"
                stroke="var(--s1)"
                strokeWidth={2}
                fill="url(#clicksFill)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                isAnimationActive={false}
              />
            )}
            {!hidden.unique_visitors && (
              <Line
                type="monotone"
                dataKey="unique_visitors"
                stroke="var(--s2)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------- Ranked breakdown (bar list) ----------

export function BarList({
  rows,
  label,
  onSelect,
  active,
  empty = "No data for this period",
  limit = 8,
  heading = "Name",
}: {
  heading?: string;
  rows: Breakdown[];
  label: (value: string) => ReactNode;
  onSelect?: (value: string) => void;
  active?: string;
  empty?: string;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">{empty}</p>;
  const total = rows.reduce((s, r) => s + r.clicks, 0);
  const max = Math.max(...rows.map((r) => r.clicks));
  const shown = expanded ? rows : rows.slice(0, limit);
  return (
    <div>
      <div className="mb-1 flex justify-between px-2 text-[11px] font-medium uppercase tracking-wide text-muted">
        <span>{heading}</span>
        <span>Clicks</span>
      </div>
      <ul className="space-y-1">
        {shown.map((r) => {
          const isActive = active === r.value;
          return (
            <li key={r.value}>
              <button
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(r.value)}
                title={`${fmt(r.clicks)} clicks · ${fmt(r.unique_visitors)} unique · ${fmtPct(r.clicks, total)}${onSelect ? " — click to filter" : ""}`}
                className={`group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md px-2 py-1.5 text-left text-sm ${onSelect ? "cursor-pointer" : "cursor-default"} ${isActive ? "ring-2 ring-accent" : ""}`}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-md bg-[var(--s1)] opacity-[0.16] transition-opacity group-hover:opacity-[0.28]"
                  style={{ width: `${Math.max(2, (r.clicks / max) * 100)}%` }}
                  aria-hidden
                />
                <span className="relative flex min-w-0 items-center gap-2 truncate text-ink">
                  {label(r.value)}
                  {onSelect && <Filter size={12} className="shrink-0 text-muted opacity-0 group-hover:opacity-100" aria-hidden />}
                </span>
                <span className="tabular relative shrink-0 text-ink">
                  {fmt(r.clicks)} <span className="inline-block w-11 text-right text-xs text-muted">{fmtPct(r.clicks, total)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > limit && (
        <button type="button" className="mt-2 px-2 text-xs font-medium text-accent hover:underline" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

// ---------- Part-to-whole (devices, sources) ----------

const SLOT = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];

export function SplitBar({
  rows,
  order,
  label,
  onSelect,
  active,
}: {
  rows: Breakdown[];
  order: string[];
  label: (v: string) => string;
  onSelect?: (value: string) => void;
  active?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = rows.reduce((s, r) => s + r.clicks, 0);
  if (!total) return <p className="py-8 text-center text-sm text-muted">No data for this period</p>;
  // Color follows the category (fixed order), never its rank.
  const sorted = order.map((v) => rows.find((r) => r.value === v)).filter(Boolean) as Breakdown[];
  const rest = rows.filter((r) => !order.includes(r.value));
  const all = [...sorted, ...rest];
  const colorOf = (v: string) => SLOT[Math.min(order.indexOf(v) === -1 ? 3 : order.indexOf(v), 3)];
  return (
    <div>
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label={all.map((r) => `${label(r.value)} ${fmtPct(r.clicks, total)}`).join(", ")}>
        {all.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onSelect?.(r.value)}
            onMouseEnter={() => setHover(r.value)}
            onMouseLeave={() => setHover(null)}
            className="h-full transition-opacity first:rounded-l-md last:rounded-r-md"
            style={{ width: `${(r.clicks / total) * 100}%`, background: colorOf(r.value), opacity: hover && hover !== r.value ? 0.45 : 1, outline: active === r.value ? "2px solid var(--ink)" : undefined, outlineOffset: -2 }}
            title={`${label(r.value)}: ${fmt(r.clicks)} clicks (${fmtPct(r.clicks, total)})`}
          />
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {all.map((r) => (
          <li key={r.value}>
            <button
              type="button"
              onClick={() => onSelect?.(r.value)}
              onMouseEnter={() => setHover(r.value)}
              onMouseLeave={() => setHover(null)}
              className={`flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-surface-2 ${active === r.value ? "bg-surface-2 font-medium" : ""}`}
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorOf(r.value) }} />
              <span className="text-ink">{label(r.value)}</span>
              <span className="tabular ml-auto text-ink">{fmt(r.clicks)}</span>
              <span className="tabular w-12 text-right text-xs text-muted">{fmtPct(r.clicks, total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Weekday x hour heatmap ----------

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Heatmap({ grid }: { grid: number[][] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(1, ...grid.flat());
  const step = (v: number) => (v === 0 ? 0 : Math.min(6, 1 + Math.floor((v / max) * 5.999)));
  const hourLabel = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
  const peak = grid.flatMap((row, d) => row.map((v, h) => ({ v, d, h }))).sort((a, b) => b.v - a.v)[0];
  return (
    <div>
      <div className="mb-2 h-5 text-xs text-ink-2">
        {hover ? (
          <>
            <span className="font-medium text-ink">{DAYS[hover.d]} {hourLabel(hover.h)}</span> · {fmt(grid[hover.d][hover.h])} clicks
          </>
        ) : peak?.v ? (
          <>Busiest: <span className="font-medium text-ink">{DAYS[peak.d]} around {hourLabel(peak.h)}</span></>
        ) : (
          "No clicks yet"
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[520px] gap-[2px]" style={{ gridTemplateColumns: "32px repeat(24, minmax(0, 1fr))" }} onMouseLeave={() => setHover(null)}>
          {grid.map((row, d) => (
            <div key={d} className="contents">
              <div className="pr-1 text-right text-[11px] leading-5 text-muted">{DAYS[d]}</div>
              {row.map((v, h) => (
                <div
                  key={h}
                  onMouseEnter={() => setHover({ d, h })}
                  className="h-5 rounded-[3px]"
                  style={{
                    background: `var(--q${step(v)})`,
                    outline: hover?.d === d && hover?.h === h ? "2px solid var(--ink)" : undefined,
                  }}
                  title={`${DAYS[d]} ${hourLabel(h)}: ${fmt(v)} clicks`}
                />
              ))}
            </div>
          ))}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="pt-1 text-center text-[10px] text-muted">
              {h % 6 === 0 ? hourLabel(h) : ""}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted">
        Fewer
        {[0, 1, 2, 3, 4, 5, 6].map((s) => (
          <span key={s} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `var(--q${s})` }} />
        ))}
        More
      </div>
    </div>
  );
}

// ---------- Sparkline ----------

export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const stepX = width / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * stepX).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  const sum = values.reduce((a, b) => a + b, 0);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${sum} clicks in the last 14 days`}>
      <title>{`${fmt(sum)} clicks in the last 14 days`}</title>
      <polyline points={`0,${height} ${pts.join(" ")} ${width},${height}`} fill="var(--s1)" opacity={0.12} stroke="none" />
      <polyline points={pts.join(" ")} fill="none" stroke="var(--s1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
