/**
 * Fills the database with a demo account and ~90 days of realistic click data,
 * so the dashboard has something to show on first run.
 *
 *   npm run seed            -> demo@linkforge.dev / demo12345
 */
import { db } from "./db.js";
import { generateApiKey, hashPassword, sha256 } from "./lib/auth.js";
import { newId } from "./lib/codes.js";
import { createLink, createLinkSchema } from "./lib/links.js";

const EMAIL = "demo@linkforge.dev";
const PASSWORD = "demo12345";

function weighted<T>(pairs: [T, number][]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[0][0];
}

const REFERRERS: [string | null, number][] = [
  [null, 30], ["https://t.co/abc", 16], ["https://www.linkedin.com/feed/", 14], ["https://www.google.com/", 12],
  ["https://www.facebook.com/", 8], ["https://www.instagram.com/", 7], ["https://news.ycombinator.com/", 5],
  ["https://www.reddit.com/r/webdev/", 5], ["https://mail.google.com/", 3],
];
const PLACES: [[string, string], number][] = [
  [["US", "San Francisco"], 14], [["US", "New York"], 12], [["US", "Austin"], 6], [["IN", "Bengaluru"], 12], [["IN", "Mumbai"], 6],
  [["GB", "London"], 9], [["DE", "Berlin"], 7], [["CA", "Toronto"], 6], [["FR", "Paris"], 4], [["BR", "São Paulo"], 4],
  [["AU", "Sydney"], 3], [["JP", "Tokyo"], 3], [["NL", "Amsterdam"], 2], [["SG", "Singapore"], 2], [["Unknown", ""], 2],
];
const CLIENTS: [[string, string, string], number][] = [
  [["mobile", "Mobile Safari", "iOS"], 26], [["mobile", "Chrome", "Android"], 20], [["desktop", "Chrome", "macOS"], 18],
  [["desktop", "Chrome", "Windows"], 16], [["desktop", "Safari", "macOS"], 7], [["desktop", "Firefox", "Windows"], 4],
  [["desktop", "Edge", "Windows"], 4], [["tablet", "Mobile Safari", "iOS"], 3], [["desktop", "Firefox", "Linux"], 2],
];

const LINKS = [
  { url: "https://github.com/features/copilot", title: "Product launch announcement", tags: ["launch", "social"], custom_code: "launch", weight: 10 },
  { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Conference talk recording", tags: ["video"], weight: 6 },
  { url: "https://docs.example.com/getting-started/installation", title: "Docs: installation guide", tags: ["docs"], custom_code: "install", weight: 5 },
  { url: "https://shop.example.com/collections/fall-sale", title: "Fall sale", tags: ["marketing", "email"], utm: { source: "newsletter", medium: "email", campaign: "fall-sale" }, weight: 8 },
  { url: "https://www.linkedin.com/jobs/view/123456789", title: "We're hiring: Senior Engineer", tags: ["hiring", "social"], weight: 4 },
  { url: "https://blog.example.com/2026/scaling-sqlite-to-a-billion-rows", title: "Blog: scaling SQLite", tags: ["blog"], weight: 7 },
  { url: "https://apps.apple.com/app/id000000000", title: "Mobile app download", tags: ["app"], ios_url: "https://apps.apple.com/app/id000000000", android_url: "https://play.google.com/store/apps/details?id=com.example", weight: 5 },
  { url: "https://forms.example.com/beta-signup", title: "Private beta signup", tags: ["launch"], password: "beta2026", weight: 2 },
  { url: "https://example.com/menu.pdf", title: "Restaurant menu (QR)", tags: ["qr"], weight: 3, qrHeavy: true },
  { url: "https://example.com/webinar/registration", title: "Webinar registration", tags: ["marketing"], max_clicks: 500, weight: 3 },
  { url: "https://example.com/black-friday-preview", title: "Black Friday teaser (expired)", tags: ["marketing"], expires_at: "2026-09-01T00:00:00Z", weight: 2 },
  { url: "https://github.com/bhargavs98/linkforge", title: "LinkForge on GitHub", tags: ["dev"], custom_code: "repo", weight: 4 },
];

async function main() {
  const existing = await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", [EMAIL]);
  if (existing) {
    const owned = "SELECT id FROM links WHERE user_id = ?";
    await db.batch([
      { sql: `DELETE FROM clicks WHERE link_id IN (${owned})`, args: [existing.id] },
      { sql: "DELETE FROM links WHERE user_id = ?", args: [existing.id] },
      { sql: "DELETE FROM api_keys WHERE user_id = ?", args: [existing.id] },
      { sql: "DELETE FROM webhooks WHERE user_id = ?", args: [existing.id] },
      { sql: "DELETE FROM users WHERE id = ?", args: [existing.id] },
    ]);
  }

  const userId = newId();
  await db.run("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)", [userId, EMAIL, "Demo User", await hashPassword(PASSWORD)]);

  // Multi-row INSERTs: one round trip per 200 clicks instead of one per click (matters against a remote DB).
  type Click = (string | number | null)[];
  async function insertClicks(rows: Click[]) {
    const CHUNK = 200;
    const statements = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      statements.push({
        sql: `INSERT INTO clicks (link_id, ts, visitor_hash, referrer, referrer_domain, country, city, device, browser, os, source, is_bot)
              VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
        args: chunk.flat(),
      });
    }
    if (statements.length) await db.batch(statements);
  }
  const DAY = 86_400_000;
  const now = Date.now();
  let totalClicks = 0;

  for (const [i, spec] of LINKS.entries()) {
    const { weight, qrHeavy, ...input } = spec;
    const link = await createLink(userId, createLinkSchema.parse(input));
    const ageDays = 90 - i * 4;
    await db.run("UPDATE links SET created_at = ? WHERE id = ?", [new Date(now - ageDays * DAY).toISOString(), link.id]);
    const expiresAt = spec.expires_at ? new Date(spec.expires_at).getTime() : Infinity;

    // Each link trends differently: some grow, some fade.
    const trend = (Math.random() < 0.3 ? -1 : 1) * (60 + Math.random() * 180);
    const visitors = Array.from({ length: weight * 25 }, (_, n) => sha256(`${link.id}-${n}`).slice(0, 32));
    let count = 0;
    const clicks: Click[] = [];
    {
      for (let d = ageDays; d >= 0; d--) {
        const dayStart = now - d * DAY;
        if (dayStart > expiresAt) break;
        const weekday = new Date(dayStart).getUTCDay();
        const launchSpike = d > ageDays - 4 ? 4 : 1; // links get a burst right after they're shared
        const growth = 1 + (ageDays - d) / trend;
        const base = weight * 2.2 * Math.max(0.2, growth) * launchSpike * (weekday === 0 || weekday === 6 ? 0.6 : 1);
        const n = Math.max(0, Math.round(base * (0.6 + Math.random() * 0.8)));
        for (let k = 0; k < n; k++) {
          if (spec.max_clicks && count >= spec.max_clicks) break;
          // Business hours skew: most clicks between 13:00-03:00 UTC (US + EU + IN daytime).
          const hour = weighted(Array.from({ length: 24 }, (_, h) => [h, h >= 13 || h <= 3 ? 3 : h >= 8 ? 2 : 1] as [number, number]));
          const ts = new Date(dayStart - (dayStart % DAY) + hour * 3_600_000 + Math.random() * 3_600_000);
          if (ts.getTime() > now) continue;
          const ref = weighted(REFERRERS);
          const [country, city] = weighted(PLACES);
          const [device, browser, os] = weighted(CLIENTS);
          const isBot = Math.random() < 0.03;
          clicks.push([
            link.id, ts.toISOString(), visitors[Math.floor(Math.random() * visitors.length)], ref,
            ref ? new URL(ref).hostname.replace(/^www\./, "") : "Direct", country, city || null,
            device, browser, os, qrHeavy || Math.random() < 0.06 ? "qr" : "link", Number(isBot),
          ]);
          if (!isBot) count++;
        }
      }
    }
    await insertClicks(clicks);
    await db.run("UPDATE links SET total_clicks = ?, last_clicked_at = (SELECT MAX(ts) FROM clicks WHERE link_id = ?) WHERE id = ?", [count, link.id, link.id]);
    totalClicks += count;
  }

  const { key, prefix, hash } = generateApiKey();
  await db.run("INSERT INTO api_keys (id, user_id, name, prefix, key_hash) VALUES (?, ?, ?, ?, ?)", [newId(), userId, "Seeded demo key", prefix, hash]);

  console.log(`Seeded ${LINKS.length} links and ${totalClicks.toLocaleString()} clicks.`);
  console.log(`  Login:   ${EMAIL} / ${PASSWORD}`);
  console.log(`  API key: ${key}   (shown once)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
