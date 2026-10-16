/**
 * @linkforge/sdk — a tiny, dependency-free client for the LinkForge API.
 * Works in Node 18+, Deno, Bun, edge runtimes and browsers (anything with fetch + Web Crypto).
 *
 *   const lf = new LinkForge({ apiKey: process.env.LINKFORGE_API_KEY!, baseUrl: "https://lnk.example.com" });
 *   const link = await lf.links.create({ url: "https://example.com/long" });
 */

export interface LinkForgeOptions {
  apiKey: string;
  /** Origin of your LinkForge server, e.g. https://lnk.example.com (no /api suffix). */
  baseUrl: string;
  /** Custom fetch (for tests, retries or older runtimes). */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 10s. */
  timeoutMs?: number;
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
}

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface CreateLinkInput {
  url: string;
  custom_code?: string;
  title?: string;
  tags?: string[];
  password?: string;
  expires_at?: string | Date;
  max_clicks?: number;
  redirect_type?: 301 | 302;
  ios_url?: string;
  android_url?: string;
  utm?: Utm;
}

export interface UpdateLinkInput {
  url?: string;
  code?: string;
  title?: string | null;
  tags?: string[];
  password?: string | null;
  expires_at?: string | Date | null;
  max_clicks?: number | null;
  redirect_type?: 301 | 302;
  ios_url?: string | null;
  android_url?: string | null;
  is_active?: boolean;
  utm?: Utm;
}

export interface ListLinksParams {
  q?: string;
  tag?: string;
  status?: "active" | "disabled" | "expired" | "protected";
  sort?: "created_desc" | "created_asc" | "clicks_desc" | "clicks_asc" | "last_clicked";
  page?: number;
  limit?: number;
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

export interface AnalyticsParams {
  from?: string | Date;
  to?: string | Date;
  interval?: "hour" | "day" | "week" | "month";
  include_bots?: boolean;
  referrer?: string;
  country?: string;
  city?: string;
  device?: "desktop" | "mobile" | "tablet";
  browser?: string;
  os?: string;
  source?: "link" | "qr";
}

export interface Report {
  range: { from: string; to: string; interval: string };
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

export interface Click {
  ts: string;
  referrer: string | null;
  referrer_domain: string;
  country: string;
  city: string | null;
  device: string;
  browser: string;
  os: string;
  source: "link" | "qr";
  is_bot: boolean;
}

export type WebhookEvent = "link.created" | "link.updated" | "link.deleted" | "link.clicked";

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  is_active: boolean;
  last_status: number | null;
  last_delivery_at: string | null;
  created_at: string;
}

export class LinkForgeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "LinkForgeError";
  }
}

type Query = Record<string, string | number | boolean | Date | undefined | null>;

function toQuery(params: Query = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, v instanceof Date ? v.toISOString() : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

const isoDates = <T extends object>(body: T): T =>
  Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) as T;

export class LinkForge {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: LinkForgeOptions) {
    if (!opts.apiKey) throw new Error("LinkForge: apiKey is required");
    if (!opts.baseUrl) throw new Error("LinkForge: baseUrl is required");
    this.base = opts.baseUrl.replace(/\/+$/, "") + "/api/v1";
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Low-level request helper; every method below goes through it. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.apiKey}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const err = data?.error ?? {};
      throw new LinkForgeError(res.status, err.code ?? "http_error", err.message ?? `HTTP ${res.status}`, err.details);
    }
    return data as T;
  }

  readonly links = {
    create: (input: CreateLinkInput) => this.request<Link>("POST", "/links", isoDates(input)),
    /** Up to 500 per call. Never throws for individual items — check each result's `ok`. */
    bulkCreate: (inputs: CreateLinkInput[]) =>
      this.request<{ created: number; failed: number; results: { index: number; ok: boolean; link?: Link; error?: string }[] }>(
        "POST",
        "/links/bulk",
        { links: inputs.map(isoDates) },
      ),
    list: (params: ListLinksParams = {}) => this.request<{ data: Link[]; pagination: Pagination }>("GET", `/links${toQuery(params as Query)}`),
    /** Async iterator over every link matching the filters, fetching pages lazily. */
    iterate: (params: Omit<ListLinksParams, "page"> = {}) => this.iterateLinks(params),
    get: (id: string) => this.request<Link>("GET", `/links/${encodeURIComponent(id)}`),
    update: (id: string, input: UpdateLinkInput) => this.request<Link>("PATCH", `/links/${encodeURIComponent(id)}`, isoDates(input)),
    delete: (id: string) => this.request<void>("DELETE", `/links/${encodeURIComponent(id)}`),
    analytics: (id: string, params: AnalyticsParams = {}) =>
      this.request<Report & { link: Link }>("GET", `/links/${encodeURIComponent(id)}/analytics${toQuery(params as Query)}`),
    clicks: (id: string, params: { page?: number; limit?: number } = {}) =>
      this.request<{ data: Click[]; pagination: Pagination }>("GET", `/links/${encodeURIComponent(id)}/clicks${toQuery(params)}`),
    /** URL of the QR image. It needs the API key, so fetch it server-side (e.g. `lf.request` or your own fetch with the header). */
    qrUrl: (id: string, opts: { format?: "png" | "svg"; size?: number; color?: string; bg?: string } = {}) =>
      `${this.base}/links/${encodeURIComponent(id)}/qr${toQuery(opts)}`,
  };

  private async *iterateLinks(params: Omit<ListLinksParams, "page">): AsyncGenerator<Link> {
    for (let page = 1; ; page++) {
      const res = await this.request<{ data: Link[]; pagination: Pagination }>("GET", `/links${toQuery({ ...params, page, limit: params.limit ?? 100 } as Query)}`);
      yield* res.data;
      if (page >= res.pagination.pages) return;
    }
  }

  readonly analytics = {
    overview: (params: AnalyticsParams = {}) =>
      this.request<Report & { links: { total_links: number; active_links: number; lifetime_clicks: number }; top_links: (Breakdown & { id: string; code: string })[] }>(
        "GET",
        `/analytics/overview${toQuery(params as Query)}`,
      ),
  };

  readonly tags = {
    list: () => this.request<{ data: { tag: string; links: number }[] }>("GET", "/tags"),
  };

  readonly webhooks = {
    list: () => this.request<{ data: Webhook[] }>("GET", "/webhooks"),
    create: (input: { url: string; events?: WebhookEvent[] }) => this.request<Webhook>("POST", "/webhooks", input),
    update: (id: string, input: { url?: string; events?: WebhookEvent[]; is_active?: boolean }) =>
      this.request<Webhook>("PATCH", `/webhooks/${encodeURIComponent(id)}`, input),
    delete: (id: string) => this.request<void>("DELETE", `/webhooks/${encodeURIComponent(id)}`),
    test: (id: string) => this.request<{ delivered: boolean; status: number }>("POST", `/webhooks/${encodeURIComponent(id)}/test`),
  };
}

/**
 * Verifies a webhook delivery. Pass the RAW request body (string), the
 * `X-LinkForge-Signature` header and your webhook secret.
 */
export async function verifyWebhookSignature(rawBody: string, signatureHeader: string | null | undefined, secret: string) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  const expected = "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return diff === 0;
}

export default LinkForge;
