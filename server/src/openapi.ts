import { config } from "./config.js";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, description = "OK") => ({ description, content: { "application/json": { schema } } });
const err = (description: string) => json(ref("Error"), description);
const idParam = { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Link id (not the short code)" };
const rangeParams = [
  { name: "from", in: "query", schema: { type: "string", format: "date-time" }, description: "Start (ISO date or datetime). Default: 30 days before `to`." },
  { name: "to", in: "query", schema: { type: "string", format: "date-time" }, description: "End (ISO date or datetime). Default: now." },
  { name: "interval", in: "query", schema: { type: "string", enum: ["hour", "day", "week", "month"] }, description: "Bucket size. Default: picked from the range." },
  { name: "include_bots", in: "query", schema: { type: "string", enum: ["true", "false"] } },
  { name: "tz_offset", in: "query", schema: { type: "integer" }, description: "Minutes, as returned by JS `Date#getTimezoneOffset()`. Shifts the heatmap." },
];
const breakdown = { type: "array", items: { type: "object", properties: { value: { type: "string" }, clicks: { type: "integer" }, unique_visitors: { type: "integer" } } } };

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "LinkForge API",
    version: "1.0.0",
    description:
      "Create and manage short links, read click analytics, and subscribe to webhooks.\n\n" +
      "**Authentication:** send `Authorization: Bearer <API key>` (or `X-API-Key: <API key>`). Create keys in the dashboard under **Developers**.\n\n" +
      "**Errors** always look like `{ \"error\": { \"code\": \"...\", \"message\": \"...\" } }`.",
  },
  servers: [{ url: `${config.baseUrl}/api/v1` }],
  security: [{ bearer: [] }],
  tags: [
    { name: "Links" },
    { name: "Analytics" },
    { name: "Webhooks" },
    { name: "Account" },
  ],
  paths: {
    "/links": {
      get: {
        tags: ["Links"],
        summary: "List links",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Search code, title and destination" },
          { name: "tag", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "disabled", "expired", "protected"] } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["created_desc", "created_asc", "clicks_desc", "clicks_asc", "last_clicked"] } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
        ],
        responses: { 200: json({ type: "object", properties: { data: { type: "array", items: ref("Link") }, pagination: ref("Pagination") } }) },
      },
      post: {
        tags: ["Links"],
        summary: "Shorten a URL",
        requestBody: { required: true, content: { "application/json": { schema: ref("CreateLink"), example: { url: "https://example.com/very/long/path?x=1", custom_code: "launch", tags: ["marketing"], utm: { source: "twitter", campaign: "launch" } } } } },
        responses: { 201: json(ref("Link"), "Created"), 400: err("Invalid input"), 409: err("Custom back-half already taken") },
      },
    },
    "/links/bulk": {
      post: {
        tags: ["Links"],
        summary: "Shorten up to 500 URLs in one request",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { links: { type: "array", items: ref("CreateLink"), maxItems: 500 } } } } } },
        responses: {
          207: json({
            type: "object",
            properties: {
              created: { type: "integer" },
              failed: { type: "integer" },
              results: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, ok: { type: "boolean" }, link: ref("Link"), error: { type: "string" } } } },
            },
          }, "Per-item results"),
        },
      },
    },
    "/links/{id}": {
      parameters: [idParam],
      get: { tags: ["Links"], summary: "Get a link", responses: { 200: json(ref("Link")), 404: err("Not found") } },
      patch: {
        tags: ["Links"],
        summary: "Update a link",
        description: "Every field is optional. Send `null` to clear `password`, `expires_at`, `max_clicks`, `ios_url` or `android_url`.",
        requestBody: { required: true, content: { "application/json": { schema: ref("UpdateLink") } } },
        responses: { 200: json(ref("Link")), 404: err("Not found"), 409: err("Back-half taken") },
      },
      delete: { tags: ["Links"], summary: "Delete a link and its click history", responses: { 204: { description: "Deleted" } } },
    },
    "/links/{id}/qr": {
      parameters: [idParam],
      get: {
        tags: ["Links"],
        summary: "QR code for the short link",
        parameters: [
          { name: "format", in: "query", schema: { type: "string", enum: ["png", "svg"], default: "png" } },
          { name: "size", in: "query", schema: { type: "integer", default: 512 } },
          { name: "color", in: "query", schema: { type: "string", example: "111827" }, description: "Hex without #" },
          { name: "bg", in: "query", schema: { type: "string", example: "ffffff" } },
          { name: "download", in: "query", schema: { type: "string", enum: ["1"] } },
        ],
        responses: { 200: { description: "Image", content: { "image/png": {}, "image/svg+xml": {} } } },
      },
    },
    "/links/{id}/analytics": {
      parameters: [idParam],
      get: { tags: ["Analytics"], summary: "Full analytics report for one link", parameters: rangeParams, responses: { 200: json(ref("Report")) } },
    },
    "/links/{id}/clicks": {
      parameters: [idParam],
      get: {
        tags: ["Analytics"],
        summary: "Raw click stream (newest first)",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
        ],
        responses: { 200: json({ type: "object", properties: { data: { type: "array", items: ref("Click") }, pagination: ref("Pagination") } }) },
      },
    },
    "/links/{id}/clicks.csv": {
      parameters: [idParam],
      get: { tags: ["Analytics"], summary: "Export every click as CSV", responses: { 200: { description: "CSV", content: { "text/csv": {} } } } },
    },
    "/analytics/overview": {
      get: { tags: ["Analytics"], summary: "Account-wide analytics with top links", parameters: rangeParams, responses: { 200: json(ref("Report")) } },
    },
    "/tags": {
      get: { tags: ["Links"], summary: "Tags in use, with link counts", responses: { 200: json({ type: "object" }) } },
    },
    "/webhooks": {
      get: { tags: ["Webhooks"], summary: "List webhooks", responses: { 200: json({ type: "object", properties: { data: { type: "array", items: ref("Webhook") } } }) } },
      post: {
        tags: ["Webhooks"],
        summary: "Create a webhook",
        description:
          "Each delivery is a POST with JSON `{ event, created_at, data }` and header `X-LinkForge-Signature: sha256=<hex>` = HMAC-SHA256 of the raw body using the webhook `secret`.",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string" }, events: { type: "array", items: { type: "string", enum: ["link.created", "link.updated", "link.deleted", "link.clicked"] } } } } } } },
        responses: { 201: json(ref("Webhook")) },
      },
    },
    "/webhooks/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      patch: { tags: ["Webhooks"], summary: "Update a webhook", responses: { 200: json(ref("Webhook")) } },
      delete: { tags: ["Webhooks"], summary: "Delete a webhook", responses: { 204: { description: "Deleted" } } },
    },
    "/webhooks/{id}/test": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      post: { tags: ["Webhooks"], summary: "Send a test event", responses: { 200: json({ type: "object", properties: { delivered: { type: "boolean" }, status: { type: "integer" } } }) } },
    },
    "/auth/me": {
      get: { tags: ["Account"], summary: "Who am I", responses: { 200: json({ type: "object" }) } },
    },
  },
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "API key (lf_...) or dashboard session token" } },
    schemas: {
      Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } } },
      Pagination: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer" }, total: { type: "integer" }, pages: { type: "integer" } } },
      Utm: { type: "object", properties: { source: { type: "string" }, medium: { type: "string" }, campaign: { type: "string" }, term: { type: "string" }, content: { type: "string" } } },
      CreateLink: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "Destination (http/https)" },
          custom_code: { type: "string", description: "Custom back-half, 3-64 chars [A-Za-z0-9_-]" },
          title: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          password: { type: "string", description: "Visitors must enter it before redirecting" },
          expires_at: { type: "string", format: "date-time" },
          max_clicks: { type: "integer", description: "Link stops working after this many (non-bot) clicks" },
          redirect_type: { type: "integer", enum: [301, 302], default: 302 },
          ios_url: { type: "string", description: "Destination for iOS visitors" },
          android_url: { type: "string", description: "Destination for Android visitors" },
          utm: ref("Utm"),
        },
      },
      UpdateLink: {
        type: "object",
        properties: {
          url: { type: "string" },
          code: { type: "string", description: "Change the back-half" },
          title: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          password: { type: ["string", "null"] },
          expires_at: { type: ["string", "null"] },
          max_clicks: { type: ["integer", "null"] },
          redirect_type: { type: "integer", enum: [301, 302] },
          ios_url: { type: ["string", "null"] },
          android_url: { type: ["string", "null"] },
          is_active: { type: "boolean" },
          utm: ref("Utm"),
        },
      },
      Link: {
        type: "object",
        properties: {
          id: { type: "string" },
          code: { type: "string" },
          short_url: { type: "string" },
          long_url: { type: "string" },
          title: { type: ["string", "null"] },
          tags: { type: "array", items: { type: "string" } },
          password_protected: { type: "boolean" },
          expires_at: { type: ["string", "null"] },
          max_clicks: { type: ["integer", "null"] },
          redirect_type: { type: "integer" },
          ios_url: { type: ["string", "null"] },
          android_url: { type: ["string", "null"] },
          is_active: { type: "boolean" },
          status: { type: "string", enum: ["active", "disabled", "expired", "limit_reached"] },
          total_clicks: { type: "integer" },
          last_clicked_at: { type: ["string", "null"] },
          qr_code_url: { type: "string" },
          created_at: { type: "string" },
          updated_at: { type: "string" },
        },
      },
      Click: {
        type: "object",
        properties: {
          ts: { type: "string" },
          referrer: { type: ["string", "null"] },
          referrer_domain: { type: "string" },
          country: { type: "string" },
          city: { type: ["string", "null"] },
          device: { type: "string", enum: ["desktop", "mobile", "tablet"] },
          browser: { type: "string" },
          os: { type: "string" },
          source: { type: "string", enum: ["link", "qr"] },
          is_bot: { type: "boolean" },
        },
      },
      Report: {
        type: "object",
        properties: {
          range: { type: "object" },
          totals: { type: "object", properties: { clicks: { type: "integer" }, unique_visitors: { type: "integer" }, qr_scans: { type: "integer" }, previous_clicks: { type: "integer" } } },
          timeseries: { type: "array", items: { type: "object", properties: { date: { type: "string" }, clicks: { type: "integer" }, unique_visitors: { type: "integer" } } } },
          referrers: breakdown,
          countries: breakdown,
          cities: breakdown,
          devices: breakdown,
          browsers: breakdown,
          os: breakdown,
          sources: breakdown,
          heatmap: { type: "array", description: "7 rows (Mon..Sun) x 24 hours", items: { type: "array", items: { type: "integer" } } },
        },
      },
      Webhook: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          events: { type: "array", items: { type: "string" } },
          secret: { type: "string" },
          is_active: { type: "boolean" },
          last_status: { type: ["integer", "null"] },
          last_delivery_at: { type: ["string", "null"] },
        },
      },
    },
  },
};
