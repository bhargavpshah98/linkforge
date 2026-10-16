import dotenv from "dotenv";

dotenv.config({ quiet: true });

const env = process.env;

// On Vercel, default the public URL to the project's production domain so no BASE_URL is needed.
const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined;

function stripSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export const config = {
  env: env.NODE_ENV ?? "development",
  port: Number(env.PORT ?? 4000),
  baseUrl: stripSlash(env.BASE_URL ?? vercelUrl ?? `http://localhost:${env.PORT ?? 4000}`),
  appUrl: stripSlash(env.APP_URL ?? env.BASE_URL ?? vercelUrl ?? "http://localhost:5173"),
  // Local file path, ":memory:", or a Turso URL (libsql://<db>-<org>.turso.io). DATABASE_PATH is accepted as an alias.
  databaseUrl: env.DATABASE_URL ?? env.TURSO_DATABASE_URL ?? env.DATABASE_PATH ?? "./data/linkforge.db",
  databaseAuthToken: env.DATABASE_AUTH_TOKEN ?? env.TURSO_AUTH_TOKEN,
  jwtSecret: env.JWT_SECRET ?? "dev-only-insecure-secret",
  ipHashSalt: env.IP_HASH_SALT ?? env.JWT_SECRET ?? "dev-only-salt",
  trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true" || Boolean(env.VERCEL),
  codeLength: Number(env.CODE_LENGTH ?? 7),
  // Directory of the built dashboard. When it exists the server serves it, so one process runs everything.
  webDist: env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname,
};

if (config.env === "production" && config.jwtSecret === "dev-only-insecure-secret") {
  throw new Error("JWT_SECRET must be set in production");
}
