import "server-only";
import { ZodError } from "zod";
import {
  authenticateApiKey,
  hasScope,
  type ApiScope,
  type AuthenticatedKey,
} from "@/server/services/api-keys";
import { NotFoundError } from "@/server/services/companies";
import { ScopeMismatchError } from "@/server/services/documents";

/** One error shape for the whole API. */
export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body: ApiErrorBody = {
    error: details === undefined ? { code, message } : { code, message, details },
  };
  return json(body, status);
}

/** Field-level messages from a Zod failure, keyed by path. */
function zodDetails(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "(root)";
    if (!details[key]) details[key] = issue.message;
  }
  return details;
}

/*
 * A fixed window per key, held in this process. ARCHITECTURE rules out Redis,
 * and a single container is the supported deployment, so this is the whole
 * rate limiter.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 600;
const windows = new Map<string, { count: number; resetAt: number }>();

function rateLimit(keyId: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = windows.get(keyId);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + WINDOW_MS;
    windows.set(keyId, { count: 1, resetAt });
    return { ok: true, remaining: MAX_REQUESTS - 1, resetAt };
  }

  existing.count += 1;
  return {
    ok: existing.count <= MAX_REQUESTS,
    remaining: Math.max(0, MAX_REQUESTS - existing.count),
    resetAt: existing.resetAt,
  };
}

export type ApiContext<P = Record<string, string>> = {
  request: Request;
  key: AuthenticatedKey;
  params: P;
  url: URL;
};

export type ApiHandler<P> = (ctx: ApiContext<P>) => Promise<Response>;

/**
 * Wraps a route handler with bearer authentication, scope enforcement, rate
 * limiting, and one place that turns service errors into responses.
 */
export function withApi<P extends Record<string, string> = Record<string, string>>(
  scope: ApiScope,
  handler: ApiHandler<P>,
) {
  return async (request: Request, context?: { params?: Promise<P> }): Promise<Response> => {
    const header = request.headers.get("authorization") ?? "";
    const presented = header.toLowerCase().startsWith("bearer ")
      ? header.slice("bearer ".length).trim()
      : "";

    if (presented === "") {
      return apiError(401, "unauthorized", "Provide an API key as a bearer token");
    }

    const key = await authenticateApiKey(presented);
    if (!key) return apiError(401, "unauthorized", "That API key is not valid");

    const limit = rateLimit(key.id);
    const limitHeaders = {
      "X-RateLimit-Limit": String(MAX_REQUESTS),
      "X-RateLimit-Remaining": String(limit.remaining),
      "X-RateLimit-Reset": String(Math.ceil(limit.resetAt / 1000)),
    };
    if (!limit.ok) {
      return json(
        { error: { code: "rate_limited", message: "Too many requests" } },
        429,
        { ...limitHeaders, "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      );
    }

    if (!hasScope(key.scopes, scope)) {
      return apiError(403, "forbidden", `This key needs the "${scope}" scope`);
    }

    try {
      const params = ((await context?.params) ?? {}) as P;
      const response = await handler({
        request,
        key,
        params,
        url: new URL(request.url),
      });
      for (const [name, value] of Object.entries(limitHeaders)) response.headers.set(name, value);
      return response;
    } catch (err) {
      if (err instanceof ZodError) {
        return apiError(422, "invalid_request", "Check the request body", zodDetails(err));
      }
      if (err instanceof NotFoundError) return apiError(404, "not_found", err.message);
      if (err instanceof ScopeMismatchError) return apiError(422, "invalid_request", err.message);
      if (err instanceof SyntaxError) {
        return apiError(400, "invalid_json", "The request body is not valid JSON");
      }
      throw err;
    }
  };
}

/** Parses a JSON body, rejecting anything that is not an object. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim() === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
