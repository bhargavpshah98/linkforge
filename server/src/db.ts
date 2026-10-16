import { createClient, type InArgs, type InStatement } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Each entry runs once, in order. Append new migrations; never edit old ones.
const migrations: string[] = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    last_used_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_api_keys_user ON api_keys(user_id);

  CREATE TABLE links (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    long_url       TEXT NOT NULL,
    title          TEXT,
    tags           TEXT NOT NULL DEFAULT '[]',
    password_hash  TEXT,
    expires_at     TEXT,
    max_clicks     INTEGER,
    redirect_type  INTEGER NOT NULL DEFAULT 302,
    ios_url        TEXT,
    android_url    TEXT,
    is_active      INTEGER NOT NULL DEFAULT 1,
    total_clicks   INTEGER NOT NULL DEFAULT 0,
    last_clicked_at TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_links_user_created ON links(user_id, created_at DESC);

  CREATE TABLE clicks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id         TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    ts              TEXT NOT NULL,
    visitor_hash    TEXT NOT NULL,
    referrer        TEXT,
    referrer_domain TEXT NOT NULL DEFAULT 'Direct',
    country         TEXT NOT NULL DEFAULT 'Unknown',
    city            TEXT,
    device          TEXT NOT NULL DEFAULT 'desktop',
    browser         TEXT NOT NULL DEFAULT 'Unknown',
    os              TEXT NOT NULL DEFAULT 'Unknown',
    source          TEXT NOT NULL DEFAULT 'link',
    is_bot          INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_clicks_link_ts ON clicks(link_id, ts);

  CREATE TABLE webhooks (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    events     TEXT NOT NULL DEFAULT '["link.clicked"]',
    secret     TEXT NOT NULL,
    is_active  INTEGER NOT NULL DEFAULT 1,
    last_status INTEGER,
    last_delivery_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_webhooks_user ON webhooks(user_id);
  `,
];

/**
 * DATABASE_URL picks the backend:
 *   - a file path or "file:..."       -> local SQLite file (development, Docker)
 *   - ":memory:"                      -> throwaway in-memory database (tests)
 *   - "libsql://...turso.io" + token  -> Turso, hosted SQLite (serverless deployments)
 */
function connectionUrl() {
  const url = config.databaseUrl;
  if (url === ":memory:" || /^(libsql|https?|wss?|file):/.test(url)) return url;
  fs.mkdirSync(path.dirname(path.resolve(url)), { recursive: true });
  return `file:${url}`;
}

const client = createClient({ url: connectionUrl(), authToken: config.databaseAuthToken });

const split = (sql: string) =>
  sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

async function migrate() {
  if (config.databaseUrl !== ":memory:" && !/^(libsql|https?|wss?):/.test(config.databaseUrl)) {
    await client.execute("PRAGMA journal_mode = WAL");
  }
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = await client.execute("SELECT COALESCE(MAX(version), 0) AS v FROM _migrations");
  let current = Number(done.rows[0].v);
  if (current === 0) {
    // Databases created before the _migrations table tracked their version in PRAGMA user_version.
    const legacy = Number((await client.execute("PRAGMA user_version")).rows[0]?.user_version ?? 0);
    for (let v = 1; v <= legacy; v++) {
      await client.execute({ sql: "INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", args: [v, new Date().toISOString()] });
    }
    current = legacy;
  }
  for (let i = current; i < migrations.length; i++) {
    await client.batch(
      [...split(migrations[i]), { sql: "INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", args: [i + 1, new Date().toISOString()] }],
      "write",
    );
  }
}

/** Resolves once the schema is up to date. Every query waits on it, so callers never race a cold start. */
export const ready = migrate();

type Row = Record<string, unknown>;

async function exec(sql: string, args?: InArgs) {
  await ready;
  return client.execute(args === undefined ? sql : { sql, args });
}

/** Thin promise-based query helpers over libSQL. Named params use `@name`, positional use `?`. */
export const db = {
  async all<T = Row>(sql: string, args?: InArgs): Promise<T[]> {
    return (await exec(sql, args)).rows as unknown as T[];
  },
  async get<T = Row>(sql: string, args?: InArgs): Promise<T | undefined> {
    return (await exec(sql, args)).rows[0] as unknown as T | undefined;
  },
  async run(sql: string, args?: InArgs) {
    const rs = await exec(sql, args);
    return { changes: rs.rowsAffected };
  },
  /** Runs statements atomically (all or nothing). */
  async batch(statements: InStatement[]) {
    await ready;
    return client.batch(statements, "write");
  },
  close: () => client.close(),
};
