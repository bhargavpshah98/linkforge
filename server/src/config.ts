import dotenv from "dotenv";

dotenv.config({ quiet: true });

const env = process.env;

function stripSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export const config = {
  env: env.NODE_ENV ?? "development",
  port: Number(env.PORT ?? 4000),
  baseUrl: stripSlash(env.BASE_URL ?? `http://localhost:${env.PORT ?? 4000}`),
  appUrl: stripSlash(env.APP_URL ?? "http://localhost:5173"),
  databasePath: env.DATABASE_PATH ?? "./data/linkforge.db",
  jwtSecret: env.JWT_SECRET ?? "dev-only-insecure-secret",
  ipHashSalt: env.IP_HASH_SALT ?? "dev-only-salt",
  trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
  codeLength: Number(env.CODE_LENGTH ?? 7),
  // Directory of the built dashboard. When it exists the server serves it, so one process runs everything.
  webDist: env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname,
};

if (config.env === "production" && config.jwtSecret === "dev-only-insecure-secret") {
  throw new Error("JWT_SECRET must be set in production");
}
