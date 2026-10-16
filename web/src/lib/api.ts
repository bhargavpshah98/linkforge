const TOKEN_KEY = "lf-token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(`/api/v1${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith("/auth/")) {
      setToken(null);
      window.location.assign("/login");
    }
    throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? res.statusText);
  }
  return body as T;
}

/** Fetches a binary endpoint (QR, CSV) with auth and returns an object URL. */
export async function apiBlobUrl(path: string) {
  const res = await fetch(`/api/v1${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, "error", "Download failed");
  return URL.createObjectURL(await res.blob());
}

export async function download(path: string, filename: string) {
  const url = await apiBlobUrl(path);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Types mirroring the API ----

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export type LinkStatus = "active" | "disabled" | "expired" | "limit_reached";

export interface Link {
  id: string;
  code: string;
  short_url: string;
  long_url: string;
  title: string | null;
  tags: string[];
  password_protected: boolean;
  expires_at: string | null;
  max_clicks: number | null;
  redirect_type: 301 | 302;
  ios_url: string | null;
  android_url: string | null;
  is_active: boolean;
  status: LinkStatus;
  total_clicks: number;
  last_clicked_at: string | null;
  qr_code_url: string;
  created_at: string;
  updated_at: string;
  sparkline?: number[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface Breakdown {
  value: string;
  clicks: number;
  unique_visitors: number;
}

export type FilterKey = "referrer" | "country" | "city" | "device" | "browser" | "os" | "source";
export type Filters = Partial<Record<FilterKey, string>>;

export interface Report {
  range: { from: string; to: string; interval: "hour" | "day" | "week" | "month" };
  filters: Filters;
  totals: { clicks: number; unique_visitors: number; qr_scans: number; previous_clicks: number };
  timeseries: { date: string; clicks: number; unique_visitors: number }[];
  referrers: Breakdown[];
  countries: Breakdown[];
  cities: Breakdown[];
  devices: Breakdown[];
  browsers: Breakdown[];
  os: Breakdown[];
  sources: Breakdown[];
  heatmap: number[][];
}

export interface OverviewReport extends Report {
  links: { total_links: number; active_links: number; lifetime_clicks: number };
  top_links: { id: string; code: string; title: string | null; long_url: string; clicks: number; unique_visitors: number }[];
}

export interface LinkReport extends Report {
  link: Link;
}

export interface Click {
  ts: string;
  referrer: string | null;
  referrer_domain: string;
  country: string;
  city: string | null;
  device: string;
  browser: string;
  os: string;
  source: string;
  is_bot: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
  key?: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  is_active: boolean;
  last_status: number | null;
  last_delivery_at: string | null;
  created_at: string;
}
