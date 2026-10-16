import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db.js";
import { hashPassword } from "./auth.js";
import { CODE_PATTERN, isReserved, newCode, newId } from "./codes.js";
import { badRequest, conflict } from "./http.js";

export interface LinkRow {
  id: string;
  user_id: string;
  code: string;
  long_url: string;
  title: string | null;
  tags: string;
  password_hash: string | null;
  expires_at: string | null;
  max_clicks: number | null;
  redirect_type: number;
  ios_url: string | null;
  android_url: string | null;
  is_active: number;
  total_clicks: number;
  last_clicked_at: string | null;
  created_at: string;
  updated_at: string;
}

const httpUrl = z
  .string()
  .trim()
  .max(4096)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "must be a valid http(s) URL");

const utmSchema = z
  .object({
    source: z.string().max(200).optional(),
    medium: z.string().max(200).optional(),
    campaign: z.string().max(200).optional(),
    term: z.string().max(200).optional(),
    content: z.string().max(200).optional(),
  })
  .optional();

const optionalDate = z
  .union([z.iso.datetime({ offset: true }), z.iso.date(), z.null()])
  .optional()
  .transform((v) => (v ? new Date(v).toISOString() : v));

export const createLinkSchema = z.object({
  url: httpUrl,
  custom_code: z.string().trim().regex(CODE_PATTERN, "3-64 chars: letters, numbers, - and _").optional(),
  title: z.string().trim().max(300).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  password: z.string().min(1).max(200).optional(),
  expires_at: optionalDate,
  max_clicks: z.number().int().positive().nullable().optional(),
  redirect_type: z.union([z.literal(301), z.literal(302)]).optional(),
  ios_url: httpUrl.nullable().optional(),
  android_url: httpUrl.nullable().optional(),
  utm: utmSchema,
});

export const updateLinkSchema = createLinkSchema
  .omit({ custom_code: true, password: true })
  .partial()
  .extend({
    code: z.string().trim().regex(CODE_PATTERN, "3-64 chars: letters, numbers, - and _").optional(),
    title: z.string().trim().max(300).nullable().optional(),
    password: z.string().min(1).max(200).nullable().optional(),
    is_active: z.boolean().optional(),
  });

export type CreateLinkInput = z.infer<typeof createLinkSchema>;

/** Appends UTM params to a URL without clobbering ones already present. */
export function applyUtm(url: string, utm: CreateLinkInput["utm"]) {
  if (!utm) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(utm)) {
    if (value && !u.searchParams.has(`utm_${key}`)) u.searchParams.set(`utm_${key}`, value);
  }
  return u.toString();
}

export function shortUrl(code: string) {
  return `${config.baseUrl}/${code}`;
}

export function linkStatus(row: Pick<LinkRow, "is_active" | "expires_at" | "max_clicks" | "total_clicks">) {
  if (!row.is_active) return "disabled" as const;
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return "expired" as const;
  if (row.max_clicks != null && row.total_clicks >= row.max_clicks) return "limit_reached" as const;
  return "active" as const;
}

/** The public shape of a link in every API response. */
export function serializeLink(row: LinkRow) {
  return {
    id: row.id,
    code: row.code,
    short_url: shortUrl(row.code),
    long_url: row.long_url,
    title: row.title,
    tags: JSON.parse(row.tags) as string[],
    password_protected: Boolean(row.password_hash),
    expires_at: row.expires_at,
    max_clicks: row.max_clicks,
    redirect_type: row.redirect_type,
    ios_url: row.ios_url,
    android_url: row.android_url,
    is_active: Boolean(row.is_active),
    status: linkStatus(row),
    total_clicks: row.total_clicks,
    last_clicked_at: row.last_clicked_at,
    qr_code_url: `${config.baseUrl}/api/v1/links/${row.id}/qr`,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getLinkById(id: string, userId: string) {
  return db.get<LinkRow>("SELECT * FROM links WHERE id = ? AND user_id = ?", [id, userId]);
}

const codeOwner = (code: string) => db.get<{ id: string }>("SELECT id FROM links WHERE code = ?", [code]);

export async function assertCodeAvailable(code: string, exceptId?: string) {
  if (isReserved(code)) throw badRequest(`"${code}" is a reserved word and cannot be used as a back-half`);
  const hit = await codeOwner(code);
  if (hit && hit.id !== exceptId) throw conflict(`The back-half "${code}" is already taken`);
}

async function uniqueCode() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (!(await codeOwner(code))) return code;
  }
  throw new Error("Could not generate a unique short code; increase CODE_LENGTH");
}

export async function createLink(userId: string, input: CreateLinkInput): Promise<LinkRow> {
  const longUrl = applyUtm(input.url, input.utm);
  if (new URL(longUrl).origin === config.baseUrl) throw badRequest("You cannot shorten a link that already points at this shortener");

  let code: string;
  if (input.custom_code) {
    await assertCodeAvailable(input.custom_code);
    code = input.custom_code;
  } else {
    code = await uniqueCode();
  }

  const id = newId();
  try {
    await db.run(
      `INSERT INTO links (id, user_id, code, long_url, title, tags, password_hash, expires_at, max_clicks, redirect_type, ios_url, android_url)
       VALUES (@id, @user_id, @code, @long_url, @title, @tags, @password_hash, @expires_at, @max_clicks, @redirect_type, @ios_url, @android_url)`,
      {
        id,
        user_id: userId,
        code,
        long_url: longUrl,
        title: input.title || null,
        tags: JSON.stringify([...new Set(input.tags ?? [])]),
        password_hash: input.password ? await hashPassword(input.password) : null,
        expires_at: input.expires_at ?? null,
        max_clicks: input.max_clicks ?? null,
        redirect_type: input.redirect_type ?? 302,
        ios_url: input.ios_url ?? null,
        android_url: input.android_url ?? null,
      },
    );
  } catch (err) {
    // Two requests raced for the same back-half: the UNIQUE index caught it.
    if (String(err).includes("UNIQUE constraint failed: links.code")) throw conflict(`The back-half "${code}" is already taken`);
    throw err;
  }
  return (await getLinkById(id, userId))!;
}
