import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

let token = "";
let apiKey = "";
const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  const res = await request(app).post("/api/v1/auth/register").send({ name: "Ada", email: "ada@example.com", password: "supersecret" });
  expect(res.status).toBe(201);
  token = res.body.token;
});

describe("auth", () => {
  it("rejects duplicate emails and bad passwords", async () => {
    expect((await request(app).post("/api/v1/auth/register").send({ name: "A", email: "ADA@example.com", password: "supersecret" })).status).toBe(409);
    expect((await request(app).post("/api/v1/auth/login").send({ email: "ada@example.com", password: "wrong" })).status).toBe(401);
  });

  it("requires credentials for the API", async () => {
    const res = await request(app).get("/api/v1/links");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("issues API keys that work as bearer tokens and X-API-Key", async () => {
    const created = await request(app).post("/api/v1/api-keys").set(auth()).send({ name: "CI" });
    expect(created.status).toBe(201);
    apiKey = created.body.key;
    expect(apiKey).toMatch(/^lf_/);
    expect((await request(app).get("/api/v1/links").set("authorization", `Bearer ${apiKey}`)).status).toBe(200);
    expect((await request(app).get("/api/v1/links").set("x-api-key", apiKey)).status).toBe(200);
  });

  it("does not let an API key mint more API keys", async () => {
    const res = await request(app).post("/api/v1/api-keys").set("x-api-key", apiKey).send({ name: "escalate" });
    expect(res.status).toBe(401);
  });
});

describe("links", () => {
  it("shortens a URL and redirects, recording the click", async () => {
    const created = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/a/very/long/path" });
    expect(created.status).toBe(201);
    expect(created.body.short_url).toBe(`http://sho.rt/${created.body.code}`);

    const hit = await request(app).get(`/${created.body.code}`).set("user-agent", MAC).set("referer", "https://www.linkedin.com/feed").set("cf-ipcountry", "DE");
    expect(hit.status).toBe(302);
    expect(hit.headers.location).toBe("https://example.com/a/very/long/path");

    const clicks = await request(app).get(`/api/v1/links/${created.body.id}/clicks`).set(auth());
    expect(clicks.body.data[0]).toMatchObject({ referrer_domain: "linkedin.com", country: "DE", device: "desktop", browser: "Chrome", os: "macOS", source: "link" });
    expect((await request(app).get(`/api/v1/links/${created.body.id}`).set(auth())).body.total_clicks).toBe(1);
  });

  it("supports custom back-halves and rejects reserved or duplicate ones", async () => {
    const ok = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com", custom_code: "my-launch" });
    expect(ok.status).toBe(201);
    expect((await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com", custom_code: "MY-LAUNCH" })).status).toBe(409);
    expect((await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com", custom_code: "api" })).status).toBe(400);
    expect((await request(app).post("/api/v1/links").set(auth()).send({ url: "javascript:alert(1)" })).status).toBe(400);
  });

  it("appends UTM parameters", async () => {
    const res = await request(app)
      .post("/api/v1/links")
      .set(auth())
      .send({ url: "https://example.com/p?x=1", utm: { source: "newsletter", campaign: "fall" } });
    expect(res.body.long_url).toBe("https://example.com/p?x=1&utm_source=newsletter&utm_campaign=fall");
  });

  it("routes iOS visitors to the iOS destination", async () => {
    const res = await request(app)
      .post("/api/v1/links")
      .set(auth())
      .send({ url: "https://example.com/app", ios_url: "https://apps.apple.com/app/x" });
    const hit = await request(app).get(`/${res.body.code}`).set("user-agent", IPHONE);
    expect(hit.headers.location).toBe("https://apps.apple.com/app/x");
  });

  it("protects links with a password", async () => {
    const res = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/secret", password: "open-sesame" });
    const gate = await request(app).get(`/${res.body.code}`).set("user-agent", MAC);
    expect(gate.status).toBe(200);
    expect(gate.text).toContain("This link is protected");
    const wrong = await request(app).post(`/${res.body.code}`).type("form").send({ password: "nope" }).set("user-agent", MAC);
    expect(wrong.status).toBe(401);
    const right = await request(app).post(`/${res.body.code}`).type("form").send({ password: "open-sesame" }).set("user-agent", MAC);
    expect(right.status).toBe(303);
    expect(right.headers.location).toBe("https://example.com/secret");
  });

  it("stops redirecting after expiry or click limit", async () => {
    const expired = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com", expires_at: "2020-01-01T00:00:00Z" });
    expect(expired.body.status).toBe("expired");
    expect((await request(app).get(`/${expired.body.code}`)).status).toBe(410);

    const limited = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com", max_clicks: 1 });
    expect((await request(app).get(`/${limited.body.code}`).set("user-agent", MAC)).status).toBe(302);
    expect((await request(app).get(`/${limited.body.code}`).set("user-agent", MAC)).status).toBe(410);
  });

  it("does not count bots toward totals", async () => {
    const res = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/bots" });
    await request(app).get(`/${res.body.code}`).set("user-agent", "Twitterbot/1.0");
    expect((await request(app).get(`/api/v1/links/${res.body.id}`).set(auth())).body.total_clicks).toBe(0);
  });

  it("updates, disables and deletes links", async () => {
    const res = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/old" });
    const patched = await request(app).patch(`/api/v1/links/${res.body.id}`).set(auth()).send({ url: "https://example.com/new", code: "renamed", tags: ["a", "a", "b"] });
    expect(patched.body).toMatchObject({ long_url: "https://example.com/new", code: "renamed", tags: ["a", "b"] });
    await request(app).patch(`/api/v1/links/${res.body.id}`).set(auth()).send({ is_active: false });
    expect((await request(app).get("/renamed")).status).toBe(410);
    expect((await request(app).delete(`/api/v1/links/${res.body.id}`).set(auth())).status).toBe(204);
    expect((await request(app).get("/renamed")).status).toBe(404);
  });

  it("creates links in bulk with per-item errors", async () => {
    const res = await request(app)
      .post("/api/v1/links/bulk")
      .set(auth())
      .send({ links: [{ url: "https://a.example.com" }, { url: "not a url" }, { url: "https://b.example.com", tags: ["bulk"] }] });
    expect(res.status).toBe(207);
    expect(res.body).toMatchObject({ created: 2, failed: 1 });
    const tagged = await request(app).get("/api/v1/links?tag=bulk").set(auth());
    expect(tagged.body.data).toHaveLength(1);
  });

  it("isolates users from each other's links", async () => {
    const other = await request(app).post("/api/v1/auth/register").send({ name: "Eve", email: "eve@example.com", password: "supersecret" });
    const mine = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/private" });
    const res = await request(app).get(`/api/v1/links/${mine.body.id}`).set("authorization", `Bearer ${other.body.token}`);
    expect(res.status).toBe(404);
  });

  it("serves QR codes and the + preview page", async () => {
    const res = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/qr", custom_code: "qrtest" });
    const png = await request(app).get(`/api/v1/links/${res.body.id}/qr`).set(auth());
    expect(png.headers["content-type"]).toBe("image/png");
    const svg = await request(app).get(`/api/v1/links/${res.body.id}/qr?format=svg`).set(auth()).buffer(true).parse((r, done) => {
      let text = "";
      r.on("data", (c: Buffer) => (text += c));
      r.on("end", () => done(null, text));
    });
    expect(svg.body).toContain("<svg");
    const preview = await request(app).get("/qrtest+");
    expect(preview.text).toContain("https://example.com/qr");
  });
});

describe("analytics", () => {
  it("aggregates clicks by dimension and time", async () => {
    const link = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/stats" });
    await request(app).get(`/${link.body.code}`).set("user-agent", IPHONE).set("cf-ipcountry", "IN");
    await request(app).get(`/${link.body.code}`).set("user-agent", IPHONE).set("cf-ipcountry", "IN");
    await request(app).get(`/${link.body.code}?qr=1`).set("user-agent", MAC).set("cf-ipcountry", "US").set("referer", "https://t.co/x");

    const res = await request(app).get(`/api/v1/links/${link.body.id}/analytics`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ clicks: 3, unique_visitors: 2, qr_scans: 1 });
    expect(res.body.countries[0]).toMatchObject({ value: "IN", clicks: 2 });
    expect(res.body.devices.map((d: { value: string }) => d.value).sort()).toEqual(["desktop", "mobile"]);
    expect(res.body.referrers).toContainEqual(expect.objectContaining({ value: "t.co", clicks: 1 }));
    expect(res.body.timeseries.reduce((s: number, p: { clicks: number }) => s + p.clicks, 0)).toBe(3);
    expect(res.body.heatmap).toHaveLength(7);

    const filtered = await request(app).get(`/api/v1/links/${link.body.id}/analytics?country=IN`).set(auth());
    expect(filtered.body.totals.clicks).toBe(2);
    expect(filtered.body.devices).toEqual([expect.objectContaining({ value: "mobile", clicks: 2 })]);

    const csv = await request(app).get(`/api/v1/links/${link.body.id}/clicks.csv`).set(auth());
    expect(csv.text.trim().split("\n")).toHaveLength(4);
  });

  it("returns an account overview with top links", async () => {
    const res = await request(app).get("/api/v1/analytics/overview?interval=day").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.top_links.length).toBeGreaterThan(0);
    expect(res.body.links.total_links).toBeGreaterThan(0);
  });
});

describe("webhooks", () => {
  it("creates webhooks with a signing secret", async () => {
    const res = await request(app).post("/api/v1/webhooks").set(auth()).send({ url: "https://hooks.example.com/in", events: ["link.clicked"] });
    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^whsec_/);
    expect((await request(app).get("/api/v1/webhooks").set(auth())).body.data).toHaveLength(1);
  });
});
