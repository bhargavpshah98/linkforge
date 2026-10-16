import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { db } from "../db.js";
import { unauthorized } from "./http.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  via: "session" | "api_key";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const API_KEY_PREFIX = "lf_";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export function signSession(userId: string) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "30d" });
}

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** Returns the plaintext key (shown once) plus what we persist. Only the hash is stored. */
export function generateApiKey() {
  const key = API_KEY_PREFIX + crypto.randomBytes(24).toString("base64url");
  return { key, prefix: key.slice(0, 10), hash: sha256(key) };
}

type UserRow = { id: string; email: string; name: string };

const findUser = db.prepare<[string], UserRow>("SELECT id, email, name FROM users WHERE id = ?");
const findKey = db.prepare<[string], UserRow & { key_id: string }>(
  `SELECT u.id, u.email, u.name, k.id AS key_id FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?`,
);
const touchKey = db.prepare("UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?");

function resolveToken(token: string): AuthUser | undefined {
  if (token.startsWith(API_KEY_PREFIX)) {
    const row = findKey.get(sha256(token));
    if (!row) return undefined;
    touchKey.run(row.key_id);
    return { id: row.id, email: row.email, name: row.name, via: "api_key" };
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    const row = findUser.get(payload.sub);
    return row ? { ...row, via: "session" } : undefined;
  } catch {
    return undefined;
  }
}

/** Accepts `Authorization: Bearer <session JWT | API key>` or `X-API-Key: <API key>`. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.get("authorization");
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1] ?? req.get("x-api-key");
  if (!token) return next(unauthorized());
  const user = resolveToken(token.trim());
  if (!user) return next(unauthorized("Invalid or expired credentials"));
  req.user = user;
  next();
}

/** For endpoints that should only be reachable from the dashboard (e.g. minting API keys). */
export function requireSession(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.via !== "session") return next(unauthorized("This endpoint requires a dashboard session"));
  next();
}
