import type { Request } from "express";
import { UAParser } from "ua-parser-js";
import { config } from "../config.js";
import { sha256 } from "./auth.js";

export interface ClickInfo {
  visitorHash: string;
  referrer: string | null;
  referrerDomain: string;
  country: string;
  city: string | null;
  /** Approximate (city-level) position from the visitor's IP. Never precise GPS. */
  latitude: number | null;
  longitude: number | null;
  device: string;
  browser: string;
  os: string;
  isBot: boolean;
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|facebookexternalhit|embedly|quora link preview|whatsapp|telegrambot|discordbot|preview|headless|curl|wget|python-requests|httpclient|go-http-client/i;

// Hosting providers put the visitor's country in a header; prefer those over a local lookup.
const COUNTRY_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "x-country-code", "fly-client-country", "x-appengine-country"];
const CITY_HEADERS = ["x-vercel-ip-city", "cf-ipcity", "x-appengine-city"];
// Approximate coordinates of the visitor's city. Cloudflare sends these with "Add visitor location headers" enabled.
const LAT_HEADERS = ["x-vercel-ip-latitude", "cf-iplatitude", "x-latitude"];
const LON_HEADERS = ["x-vercel-ip-longitude", "cf-iplongitude", "x-longitude"];

type GeoLookup = (ip: string) => { country?: string; city?: string; ll?: [number, number] } | null;

/** Parses a coordinate header, rounded to 2 decimals (~1 km) so we never store more precision than a city. */
function coord(raw: string | undefined, limit: number): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 100) / 100 : null;
}
let geoip: GeoLookup | null | undefined;

/** `geoip-lite` is optional (it is ~100MB). Install it in /server to get country/city without a CDN header. */
async function loadGeoip(): Promise<GeoLookup | null> {
  if (geoip !== undefined) return geoip;
  try {
    const name = "geoip-lite";
    const mod = await import(name);
    const lib = mod.default ?? mod;
    geoip = (ip: string) => lib.lookup(ip);
  } catch {
    geoip = null;
  }
  return geoip;
}
void loadGeoip();

export function clientIp(req: Request) {
  return (req.ip ?? req.socket.remoteAddress ?? "0.0.0.0").replace(/^::ffff:/, "");
}

function normalizeDomain(referrer: string | null): string {
  if (!referrer) return "Direct";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "") || "Direct";
  } catch {
    return "Direct";
  }
}

export function describeClick(req: Request): ClickInfo {
  const ua = req.get("user-agent") ?? "";
  const parsed = new UAParser(ua).getResult();
  const ip = clientIp(req);

  let country = COUNTRY_HEADERS.map((h) => req.get(h)).find(Boolean)?.toUpperCase();
  let city: string | null = CITY_HEADERS.map((h) => req.get(h)).find(Boolean) ?? null;
  let latitude = coord(LAT_HEADERS.map((h) => req.get(h)).find(Boolean), 90);
  let longitude = coord(LON_HEADERS.map((h) => req.get(h)).find(Boolean), 180);
  if (latitude === null || longitude === null) latitude = longitude = null;
  if ((!country || country === "XX" || latitude === null) && geoip) {
    const hit = geoip(ip);
    if (!country || country === "XX") {
      country = hit?.country || country;
      city = city ?? (hit?.city || null);
    }
    if (latitude === null && hit?.ll) {
      latitude = coord(String(hit.ll[0]), 90);
      longitude = coord(String(hit.ll[1]), 180);
    }
  }

  const referrer = req.get("referer") ?? req.get("referrer") ?? null;
  const deviceType = parsed.device.type;
  const device = deviceType === "mobile" || deviceType === "tablet" ? deviceType : "desktop";
  const day = new Date().toISOString().slice(0, 10);

  return {
    // Unique visitor = same IP + user agent on the same UTC day. Raw IPs are never stored.
    visitorHash: sha256(`${config.ipHashSalt}|${ip}|${ua}|${day}`).slice(0, 32),
    referrer,
    referrerDomain: normalizeDomain(referrer),
    country: country && country !== "XX" ? country : "Unknown",
    city: city ? decodeURIComponent(city) : null,
    latitude,
    longitude,
    device,
    browser: parsed.browser.name ?? "Unknown",
    os: parsed.os.name ?? "Unknown",
    isBot: !ua || BOT_PATTERN.test(ua),
  };
}

/** Picks the destination for this visitor: device-targeted URL when set, otherwise the main URL. */
export function destinationFor(
  link: { long_url: string; ios_url: string | null; android_url: string | null },
  os: string,
) {
  if (link.ios_url && /ios/i.test(os)) return link.ios_url;
  if (link.android_url && /android/i.test(os)) return link.android_url;
  return link.long_url;
}
