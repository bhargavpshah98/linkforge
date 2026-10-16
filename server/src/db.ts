import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type DB = Database.Database;

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

export function openDb(file = config.databasePath): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export const db = openDb();
