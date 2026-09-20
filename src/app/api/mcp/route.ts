import { env } from "@/lib/env";
import { authenticateApiKey, hasScope } from "@/server/services/api-keys";
import { handleMessage } from "@/server/mcp/server";
import {
  ERROR_CODES,
  failure,
  isSupportedVersion,
  type JsonRpcRequest,
} from "@/server/mcp/protocol";

export const dynamic = "force-dynamic";

/**
 * The MCP endpoint, Streamable HTTP with plain JSON responses.
 *
 * Bothy never pushes to a client, so SSE is not offered and GET answers 405,
 * which the spec allows. Authentication is an API key with the read scope —
 * the same keys the REST API uses, so access can be revoked in one place.
 */

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function rpcError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify(failure(null, code, message)), {
    status,
    headers: JSON_HEADERS,
  });
}

/** Guards against DNS rebinding, as the transport spec requires. */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // A direct client, not a browser.
  try {
    return new URL(origin).origin === new URL(env.APP_URL).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request)) {
    return rpcError(403, ERROR_CODES.invalidRequest, "Origin not allowed");
  }

  const version = request.headers.get("mcp-protocol-version");
  if (version && !isSupportedVersion(version)) {
    return rpcError(400, ERROR_CODES.invalidRequest, `Unsupported protocol version: ${version}`);
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice("bearer ".length).trim()
    : "";

  if (presented === "") {
    return new Response(
      JSON.stringify(failure(null, ERROR_CODES.invalidRequest, "Provide an API key as a bearer token")),
      { status: 401, headers: { ...JSON_HEADERS, "WWW-Authenticate": "Bearer" } },
    );
  }

  const key = await authenticateApiKey(presented);
  if (!key) return rpcError(401, ERROR_CODES.invalidRequest, "That API key is not valid");
  if (!hasScope(key.scopes, "read")) {
    return rpcError(403, ERROR_CODES.invalidRequest, 'This key needs the "read" scope');
  }

  let message: JsonRpcRequest;
  try {
    message = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(400, ERROR_CODES.parse, "The request body is not valid JSON");
  }

  if (Array.isArray(message)) {
    // Batching was removed from the protocol in 2025-06-18.
    return rpcError(400, ERROR_CODES.invalidRequest, "Send one message per request");
  }

  const response = await handleMessage(message, key.companies);

  // A notification is acknowledged with no body.
  if (!response) return new Response(null, { status: 202 });

  return new Response(JSON.stringify(response), { status: 200, headers: JSON_HEADERS });
}

/** No server-initiated stream, which the spec permits. */
export function GET(): Response {
  return new Response("This endpoint does not offer an SSE stream", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export function DELETE(): Response {
  return new Response("Sessions are not used", { status: 405, headers: { Allow: "POST" } });
}
