/**
 * The slice of MCP that Bothy speaks: Streamable HTTP with plain JSON
 * responses. SSE is optional in the spec and Bothy never pushes to a client,
 * so the endpoint answers every request with one JSON object.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const SERVER_INFO = { name: "bothy", title: "Bothy", version: "1.0.0" } as const;

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcSuccess = { jsonrpc: "2.0"; id: JsonRpcId; result: unknown };
export type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
};
export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export const ERROR_CODES = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function failure(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

/** A message with no id is a notification: it is acknowledged, never answered. */
export function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined;
}

export function isSupportedVersion(version: string): boolean {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

/** Echo the client's version when we speak it, otherwise offer our newest. */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && isSupportedVersion(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

export type ToolContent = { type: "text"; text: string };

export type ToolResult = {
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Structured data plus the same thing as text, which is what clients expect. */
export function toolResult(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/**
 * A failure inside a tool is reported in the result, not as a protocol error,
 * so the model can see what went wrong and try something else.
 */
export function toolError(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
