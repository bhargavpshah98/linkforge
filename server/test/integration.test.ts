import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import jsQR from "jsqr";
import sharp from "sharp";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

// A stand-in brand logo, configured before the app (and its config) loads.
const logoPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lf-logo-")), "logo.png");
await sharp({ create: { width: 200, height: 200, channels: 4, background: "#d0021b" } }).png().toFile(logoPath);
vi.stubEnv("QR_LOGO_PATH", logoPath);

const { createApp } = await import("../src/app.js");
const { settle } = await import("../src/lib/background.js");
const { db } = await import("../src/db.js");

const app = createApp();
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
let token = "";
const auth = () => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  const res = await request(app).post("/api/v1/auth/register").send({ name: "Partner", email: "partner@example.com", password: "supersecret" });
  token = res.body.token;
});

const binary = (r: NodeJS.ReadableStream, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on("data", (c: Buffer) => chunks.push(c));
  r.on("end", () => done(null, Buffer.concat(chunks)));
};

async function decodeQr(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
}

describe("redirect reliability", () => {
  it("still redirects when recording the click fails", async () => {
    const link = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/always-works" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const batch = vi.spyOn(db, "batch").mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked"));

    const hit = await request(app).get(`/${link.body.code}`).set("user-agent", MAC);
    expect(hit.status).toBe(302);
    expect(hit.headers.location).toBe("https://example.com/always-works");
    await settle();
    expect(errors).toHaveBeenCalledWith("background task failed:", expect.any(Error));

    batch.mockRestore();
    errors.mockRestore();
  });
});

describe("click location", () => {
  it("records approximate coordinates from hosting headers, rounded to ~1 km", async () => {
    const link = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/geo" });
    await request(app)
      .get(`/${link.body.code}`)
      .set("user-agent", MAC)
      .set("x-vercel-ip-country", "US")
      .set("x-vercel-ip-city", "San%20Jose")
      .set("x-vercel-ip-latitude", "37.33874")
      .set("x-vercel-ip-longitude", "-121.88524");
    await request(app).get(`/${link.body.code}`).set("user-agent", MAC).set("cf-iplatitude", "999").set("cf-iplongitude", "10");
    await settle();

    const clicks = await request(app).get(`/api/v1/links/${link.body.id}/clicks`).set(auth());
    expect(clicks.body.data.map((c: { latitude: number | null; longitude: number | null }) => [c.latitude, c.longitude])).toEqual(
      expect.arrayContaining([
        [37.34, -121.89],
        [null, null],
      ]),
    );
    expect(clicks.body.data.find((c: { city: string }) => c.city === "San Jose")).toBeTruthy();

    const csv = await request(app).get(`/api/v1/links/${link.body.id}/clicks.csv`).set(auth());
    expect(csv.text.split("\n")[0]).toContain("latitude,longitude");
  });
});

describe("branded QR codes", () => {
  it("puts the logo in the middle and the code still scans", async () => {
    const link = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/brand", custom_code: "brand-qr" });
    const png = await request(app).get(`/api/v1/links/${link.body.id}/qr?size=512`).set(auth()).buffer(true).parse(binary);
    expect(png.headers["content-type"]).toBe("image/png");

    expect(await decodeQr(png.body)).toBe("http://sho.rt/brand-qr?qr=1");
    // The centre pixel is the logo's red, not a black or white QR module.
    const { data } = await sharp(png.body).extract({ left: 256, top: 256, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([208, 2, 27]);
  });

  it("can skip the logo per request and embeds it in SVGs", async () => {
    const link = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/brand2" });
    const plain = await request(app).get(`/api/v1/links/${link.body.id}/qr?logo=0`).set(auth()).buffer(true).parse(binary);
    expect(await decodeQr(plain.body)).toBe(`http://sho.rt/${link.body.code}?qr=1`);
    const { data } = await sharp(plain.body).extract({ left: 256, top: 256, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).not.toEqual([208, 2, 27]);

    const svg = await request(app).get(`/api/v1/links/${link.body.id}/qr?format=svg`).set(auth()).buffer(true).parse(binary);
    expect(svg.body.toString()).toContain('<image x="');
  });
});

describe("unique short links", () => {
  it("treats back-halves case-insensitively, so every short URL is unique", async () => {
    const first = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/promo", custom_code: "Promo2026" });
    expect(first.status).toBe(201);
    const clash = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/other", custom_code: "promo2026" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("conflict");
    expect((await request(app).get("/PROMO2026").set("user-agent", MAC)).headers.location).toBe("https://example.com/promo");
  });

  it("can rename a back-half and the old one stops resolving", async () => {
    const link = await request(app).post("/api/v1/links").set(auth()).send({ url: "https://example.com/rename", custom_code: "old-name" });
    const renamed = await request(app).patch(`/api/v1/links/${link.body.id}`).set(auth()).send({ code: "new-name" });
    expect(renamed.body.short_url).toBe("http://sho.rt/new-name");
    expect((await request(app).get("/old-name")).status).toBe(404);
    expect((await request(app).get("/new-name").set("user-agent", MAC)).status).toBe(302);
  });
});
