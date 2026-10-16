import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") => new HttpError(401, "unauthorized", message);
export const notFound = (message = "Not found") => new HttpError(404, "not_found", message);
export const conflict = (message: string) => new HttpError(409, "conflict", message);

// Every API error has the same shape: { error: { code, message, details? } }
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = details[0];
    res.status(400).json({
      error: { code: "validation_error", message: first ? `${first.path || "body"}: ${first.message}` : "Invalid input", details },
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err && typeof err === "object" && "type" in err && err.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "invalid_json", message: "Request body is not valid JSON" } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
}
