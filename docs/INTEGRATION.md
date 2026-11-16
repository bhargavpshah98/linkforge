# Integrating LinkForge into your platform

This guide is for an engineering team that wants to create, manage and measure short links **from its own product through the LinkForge REST API**, for its own customers. Everything here also works from the zero-dependency TypeScript SDK in `sdk/`.

**Contents**

1. [How the integration fits together](#1-how-the-integration-fits-together)
2. [Step-by-step integration](#2-step-by-step-integration)
3. [API reference for integrators](#3-api-reference-for-integrators)
4. [Webhooks: getting clicks pushed to you](#4-webhooks-getting-clicks-pushed-to-you)
5. [Rules you can rely on](#5-rules-you-can-rely-on)
6. [Errors, retries and rate limits](#6-errors-retries-and-rate-limits)
7. [Scale and capacity](#7-scale-and-capacity)
8. [Go-live checklist](#8-go-live-checklist)

---

## 1. How the integration fits together

```
 Your backend ──(HTTPS + API key)──▶  LinkForge API   /api/v1/...      create / edit / delete links, QR codes, analytics
                                          │
 Your end users ──(click / scan)──▶  Short domain     https://<domain>/<code>   302 redirect, click recorded afterwards
                                          │
 Your backend ◀──(signed webhook)──  link.clicked / created / updated / deleted events (optional)
```

- **Your backend talks to the API.** Never call it from a browser or mobile app: an API key gives full control of the account's links.
- **Your customers only ever see short links and QR codes.** Redirects are public, need no key, and don't depend on your backend being up.
- **LinkForge runs headless.** The dashboard is optional; everything it does is available over the API.

## 2. Step-by-step integration

**Step 1. Get an environment.** Use a hosted LinkForge instance with your short domain (for example `go.yourbrand.com`), or deploy your own copy (Vercel + Turso, Docker, or plain Node; see *Deployment* in the README). Set `BASE_URL` to the short domain so every short link and QR code uses it.

**Step 2. Create an account and API keys.** Sign in to the dashboard, open **Developers → API keys** and create one key **per environment** (for example `staging`, `production`). The key is shown once and starts with `lf_`. Store it in your secret manager as `LINKFORGE_API_KEY`.

**Step 3. Make a first call.**

```bash
curl -X POST https://go.yourbrand.com/api/v1/links \
  -H "Authorization: Bearer $LINKFORGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://yourbrand.com/offers/diwali?customer=8812", "tags": ["customer:8812", "campaign:diwali"] }'
```

The response contains `id` (store it), `code`, `short_url` (give this to your customer) and `qr_code_url`.

**Step 4. Map links to your own records.** Save the returned `id` next to your record (order, campaign, customer). Tags are also searchable (`GET /links?tag=customer:8812`), so a `customer:<id>` tag lets you list one customer's links without a lookup table.

**Step 5. Serve QR codes.** `GET /links/{id}/qr?format=png&size=512` returns the image with your brand logo in the middle (see [QR codes](#qr-codes)). Cache it on your side or in a CDN: it only changes if the back-half changes.

**Step 6. Show analytics.** Pull totals per link (`GET /links/{id}`), full reports (`GET /links/{id}/analytics`), or the raw click stream (`GET /links/{id}/clicks`), or have clicks pushed to you as webhooks (step 7).

**Step 7. (Optional) Subscribe to webhooks** for `link.clicked` and the other events, and verify the signature on each delivery ([section 4](#4-webhooks-getting-clicks-pushed-to-you)).

**Step 8. Handle errors and limits** as in [section 6](#6-errors-retries-and-rate-limits), then work through the [go-live checklist](#8-go-live-checklist).

## 3. API reference for integrators

**Base URL** `https://<domain>/api/v1` · **Auth** `Authorization: Bearer <API key>` (or `X-API-Key: <API key>`) · **Format** JSON · **Interactive docs** `/api/docs` · **OpenAPI 3.1 spec** `/api/openapi.json` (generate a client for any language with `openapi-generator`).

### Links

| Method | Path | What it does |
|---|---|---|
| `POST` | `/links` | Create a short link |
| `POST` | `/links/bulk` | Create up to 500 in one call; HTTP 207 with a result per item |
| `GET` | `/links` | List with `q` (search), `tag`, `status`, `sort`, `page`, `limit` (max 100) |
| `GET` | `/links/{id}` | One link, including `total_clicks` and `status` |
| `PATCH` | `/links/{id}` | Change anything: destination, back-half (`code`), title, tags, expiry, limit, password, `is_active`. Send `null` to clear an optional field |
| `DELETE` | `/links/{id}` | Delete the link and its click history; the short URL stops working (404) |
| `GET` | `/links/{id}/qr` | QR code image |

**Create: every field**

| Field | Type | Notes |
|---|---|---|
| `url` | string, required | `http(s)` URL, up to 4,096 characters |
| `custom_code` | string | Your own back-half: 3 to 64 of `A-Z a-z 0-9 - _`. Omit for a random 7-character code |
| `title` | string | Up to 300 characters |
| `tags` | string[] | Up to 20 tags, 40 characters each |
| `utm` | object | `source`, `medium`, `campaign`, `term`, `content`. Added to the destination without overwriting existing UTM params |
| `expires_at` | ISO date/datetime | After this the short URL shows "Link unavailable" (HTTP 410) |
| `max_clicks` | integer | Stop redirecting after this many (non-bot) clicks |
| `password` | string | Visitors must enter it first |
| `redirect_type` | `301` or `302` | Default `302` (every visit counted). `301` may be cached by browsers |
| `ios_url`, `android_url` | URL | Send iPhone / Android visitors somewhere else (for example the app stores) |

**Rename a back-half or change the destination:**

```bash
curl -X PATCH https://go.yourbrand.com/api/v1/links/$ID \
  -H "Authorization: Bearer $LINKFORGE_API_KEY" -H "Content-Type: application/json" \
  -d '{ "code": "diwali-2026", "url": "https://yourbrand.com/offers/diwali-v2" }'
```

After a rename the old back-half stops resolving immediately and the new one works. Click history stays with the link.

### QR codes

`GET /links/{id}/qr`

| Param | Default | Notes |
|---|---|---|
| `format` | `png` | `png` or `svg` |
| `size` | `512` | 64 to 2048 px |
| `color`, `bg` | `111827`, `ffffff` | Hex without `#` |
| `logo` | `1` | Brand logo in the centre. `0` for a plain code |
| `download` | | `1` adds a `Content-Disposition: attachment` header |

The brand logo is configured once on the server (`server/assets/qr-logo.png` or `QR_LOGO_PATH`). Codes with a logo use the highest error-correction level (H, which survives about 30% damage) while the logo covers about 5% of the area, so they scan reliably; this is covered by an automated test that decodes the image. The QR encodes `<short url>?qr=1`, so scans are reported separately from clicks.

### Analytics

| Method | Path | What it returns |
|---|---|---|
| `GET` | `/links/{id}/analytics` | Totals, unique visitors, QR scans, change vs. previous period, time series, and breakdowns by referrer, country, city, device, browser, OS and source, plus a weekday × hour heatmap |
| `GET` | `/links/{id}/clicks` | Raw clicks, newest first, `page` + `limit` (max 500) |
| `GET` | `/links/{id}/clicks.csv` | Every click as CSV (streamed) |
| `GET` | `/analytics/overview` | The same report across all links, plus top links |

Filters: `from`, `to`, `interval` (`hour|day|week|month`), `tz_offset`, `include_bots`, and drill-downs `referrer`, `country`, `city`, `device`, `browser`, `os`, `source`.

**A click record:**

```json
{
  "ts": "2026-11-16T06:12:44.120Z",
  "referrer": "https://www.instagram.com/",
  "referrer_domain": "instagram.com",
  "country": "IN",
  "city": "Mumbai",
  "latitude": 19.07,
  "longitude": 72.88,
  "device": "mobile",
  "browser": "Mobile Safari",
  "os": "iOS",
  "source": "qr",
  "is_bot": false
}
```

**Location (`latitude`, `longitude`) is approximate:** the centre of the visitor's city, worked out from their IP address and rounded to 2 decimals (about 1 km). It comes from the hosting platform (Vercel and Cloudflare send it) or the optional `geoip-lite` database, and is `null` when unknown. It is **not** GPS: exact device location needs the visitor to grant permission in the browser, which would mean showing a page before every redirect, and would make the data personal data under GDPR / India's DPDP Act.

## 4. Webhooks: getting clicks pushed to you

Create one with `POST /webhooks`:

```bash
curl -X POST https://go.yourbrand.com/api/v1/webhooks \
  -H "Authorization: Bearer $LINKFORGE_API_KEY" -H "Content-Type: application/json" \
  -d '{ "url": "https://api.yourbrand.com/hooks/linkforge", "events": ["link.clicked"] }'
```

The response includes a `secret` (starts with `whsec_`). Every delivery is a `POST` with:

```
X-LinkForge-Event: link.clicked
X-LinkForge-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed with the secret>
```

```json
{
  "event": "link.clicked",
  "created_at": "2026-11-16T06:12:44.301Z",
  "data": {
    "link":  { "id": "...", "code": "diwali-2026", "short_url": "...", "long_url": "..." },
    "click": { "ts": "...", "country": "IN", "city": "Mumbai", "latitude": 19.07, "longitude": 72.88,
               "device": "mobile", "browser": "Mobile Safari", "os": "iOS", "referrer": "instagram.com", "source": "qr" }
  }
}
```

Verify the signature against the **raw** body before trusting it (`verifyWebhookSignature` in the SDK does this), answer with any 2xx within 5 seconds, and do slow work afterwards.

**Delivery is best effort today:** one attempt, 5-second timeout, no automatic retry; the last status is shown on the webhook. If you need every click, treat webhooks as a real-time signal and reconcile from `GET /links/{id}/clicks` (or the CSV) on a schedule. At high click volumes prefer pulling: one webhook per click means one HTTP request to you per click.

## 5. Rules you can rely on

- **Every short URL is unique.** Back-halves are unique across the whole instance, **ignoring case**: `Promo` and `promo` are the same link, so a second one is rejected with `409 conflict`, and `/PROMO` redirects to the same place. Generated codes are random, use an alphabet without look-alikes (no `0/O/1/l/I`), and are checked against the database before use.
- **Reserved words** (`api`, `app`, `docs`, `login`, `admin`, `settings`, and a few more) can't be back-halves.
- **Edits are immediate.** Changing the destination, renaming the back-half, disabling or deleting a link takes effect on the next click. Deleted links return 404; disabled, expired or limit-reached links return 410 "Link unavailable".
- **Bots don't count.** Link previews (Slack, WhatsApp, Twitter, crawlers) are stored but excluded from totals, click limits and webhooks.
- **No raw IPs are stored.** Unique visitors use a salted hash that rotates daily.
- **A redirect never waits for analytics.** The visitor is redirected first and the click is recorded right after, so a slow or failing database costs at most one analytics row, never a redirect. Load test: 45,400 of 45,400 clicks redirected and recorded, including 200 sent while the database was locked for 5 seconds.

## 6. Errors, retries and rate limits

Every error has one shape:

```json
{ "error": { "code": "conflict", "message": "The back-half \"promo\" is already taken" } }
```

| HTTP | `code` | Meaning | What to do |
|---|---|---|---|
| 400 | `validation_error` | A field is invalid; `details` lists each problem | Fix the request; don't retry |
| 400 | `bad_request`, `invalid_json` | Reserved back-half, shortening a short link, malformed JSON | Fix the request |
| 401 | `unauthorized` | Missing, wrong or revoked key | Check the key |
| 404 | `not_found` | Unknown id, or a link in another account | |
| 409 | `conflict` | Back-half already taken | Pick another, or omit `custom_code` |
| 429 | | Rate limited | Wait for the `RateLimit` header's reset, then retry |
| 500 | `internal_error` | Server-side failure | Retry with exponential backoff |

**Rate limits** (per minute, configurable per deployment): **3,000 per API key** (`API_KEY_RATE_LIMIT`) and 300 per IP for calls without a key (`API_RATE_LIMIT`). Responses carry standard `RateLimit` / `RateLimit-Policy` headers. Need more? Raise the limit, use several keys, or use `POST /links/bulk` (500 links per request).

**Retries and duplicates:** creating a link is not idempotent yet. If a `POST /links` times out, a retry may create a second link. To avoid duplicates, either send your own `custom_code` (a retry then gets `409`, and you can `GET /links?q=<code>` to fetch the original), or tag the request with your record id and look it up before retrying.

## 7. Scale and capacity

What has been measured (single Node.js process, local SQLite, MacBook):

| Test | Result |
|---|---|
| 20,000 redirects, 200 concurrent | 100% redirected and recorded, median 101 ms, p99 316 ms |
| 5,000 redirects, 20 concurrent | 100%, median 15 ms, p99 60 ms |
| Database locked for 5 s mid-traffic | 100% redirected; clicks recorded once the lock cleared |

What to plan for at hundreds of thousands of end users:

| Topic | Today | Recommended before or soon after launch |
|---|---|---|
| Redirect path | One indexed lookup, then redirect; click write happens after | Cache `code → link` in memory/Redis for hot links |
| Database | SQLite file, or Turso (hosted SQLite, single primary region) | Fine for millions of clicks; move click analytics to hourly roll-up tables (or ClickHouse) once the clicks table reaches tens of millions of rows |
| Hosting | One process (Docker/Node) or Vercel serverless | Run 2+ instances behind a load balancer pointing at the same Turso DB, or Vercel (scales automatically) |
| Rate limits | Counted in memory per instance | Move counters to Redis when running several instances |
| Webhooks | One attempt, no retry | Add a queue with retries for guaranteed delivery |
| Multi-tenant | Links belong to one account; use tags per customer | Workspaces / sub-accounts if your customers log in to LinkForge themselves |
| Idempotency | Not supported | `Idempotency-Key` header on `POST /links` |

## 8. Go-live checklist

- [ ] Short domain chosen, DNS pointed at the deployment, `BASE_URL` set to it
- [ ] `JWT_SECRET` and `IP_HASH_SALT` set to long random values
- [ ] `TRUST_PROXY=1` behind a load balancer (automatic on Vercel)
- [ ] Brand logo in `server/assets/qr-logo.png`; one QR scanned on iPhone and Android
- [ ] Separate API keys for staging and production, stored in a secret manager
- [ ] `API_KEY_RATE_LIMIT` sized for your peak link-creation rate
- [ ] Webhook endpoint verifies signatures and answers in under 5 seconds
- [ ] Retry policy for 429/500 with backoff; duplicate handling for `POST /links`
- [ ] Turso backups / point-in-time restore enabled (or nightly copies of the SQLite file)
- [ ] Uptime check on `GET /api/health` and on one real short link
