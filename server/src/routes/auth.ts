import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db.js";
import { hashPassword, requireAuth, signSession, verifyPassword } from "../lib/auth.js";
import { newId } from "../lib/codes.js";
import { conflict, unauthorized } from "../lib/http.js";

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, skip: () => config.env === "test" });

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8, "must be at least 8 characters").max(200),
});
const loginSchema = z.object({ email: z.email().trim().toLowerCase(), password: z.string().min(1) });

type UserRow = { id: string; email: string; name: string; password_hash: string; created_at: string };
const publicUser = (u: Omit<UserRow, "password_hash">) => ({ id: u.id, email: u.email, name: u.name, created_at: u.created_at });
const findPublicUser = (id: string) => db.get<UserRow>("SELECT id, email, name, created_at FROM users WHERE id = ?", [id]);

authRouter.post("/register", limiter, async (req, res) => {
  const body = registerSchema.parse(req.body);
  if (await db.get("SELECT 1 FROM users WHERE email = ?", [body.email])) throw conflict("An account with this email already exists");
  const id = newId();
  await db.run("INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)", [id, body.email, body.name, await hashPassword(body.password)]);
  const user = (await findPublicUser(id))!;
  res.status(201).json({ token: signSession(id), user: publicUser(user), short_domain: config.baseUrl });
});

authRouter.post("/login", limiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const user = await db.get<UserRow>("SELECT * FROM users WHERE email = ?", [body.email]);
  if (!user || !(await verifyPassword(body.password, user.password_hash))) throw unauthorized("Incorrect email or password");
  res.json({ token: signSession(user.id), user: publicUser(user), short_domain: config.baseUrl });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const [user, stats] = await Promise.all([
    findPublicUser(req.user!.id),
    db.get("SELECT COUNT(*) AS links, COALESCE(SUM(total_clicks), 0) AS clicks FROM links WHERE user_id = ?", [req.user!.id]),
  ]);
  res.json({ user: publicUser(user!), stats, auth: req.user!.via, short_domain: config.baseUrl });
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(100).optional(), password: z.string().min(8).max(200).optional() })
    .parse(req.body);
  if (body.name) await db.run("UPDATE users SET name = ? WHERE id = ?", [body.name, req.user!.id]);
  if (body.password) await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(body.password), req.user!.id]);
  res.json({ user: publicUser((await findPublicUser(req.user!.id))!) });
});
