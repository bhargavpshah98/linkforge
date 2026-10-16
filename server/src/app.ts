import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import fs from "node:fs";
import path from "node:path";
import swaggerUi from "swagger-ui-express";
import { config } from "./config.js";
import { requireAuth } from "./lib/auth.js";
import { errorHandler, notFound } from "./lib/http.js";
import { openapi } from "./openapi.js";
import { authRouter } from "./routes/auth.js";
import { developerRouter } from "./routes/developer.js";
import { linksRouter } from "./routes/links.js";
import { redirectRouter } from "./routes/redirect.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Trust exactly one proxy hop (the platform's load balancer) so req.ip is the visitor, not the proxy.
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "1mb" }));

  // ---- API ----
  const api = express.Router();
  // The API is meant to be called from other apps, so any origin may call it (auth is via bearer token, not cookies).
  api.use(cors({ origin: true, exposedHeaders: ["RateLimit", "RateLimit-Policy"] }));
  api.use(
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false, skip: () => config.env === "test" }),
  );
  api.get("/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });
  api.get("/openapi.json", (_req, res) => {
    res.json(openapi);
  });
  api.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "LinkForge API" }));
  api.use("/v1/auth", authRouter);
  api.use("/v1", requireAuth, linksRouter, developerRouter);
  api.use((_req, _res, next) => next(notFound("No such API endpoint")));
  app.use("/api", api);

  // ---- Dashboard (production build) ----
  const indexHtml = path.join(config.webDist, "index.html");
  const hasDashboard = fs.existsSync(indexHtml);
  if (hasDashboard) {
    app.use(express.static(config.webDist, { index: false, maxAge: "1h" }));
    const spa = (_req: express.Request, res: express.Response) => res.sendFile(indexHtml);
    app.get(["/", "/login", "/register", "/app", "/app/*splat"], spa);
  } else {
    app.get("/", (_req, res) => res.redirect(config.appUrl));
  }

  // ---- Short links: must be last so it never shadows the routes above ----
  app.use(redirectRouter);

  app.use(errorHandler);
  return app;
}
