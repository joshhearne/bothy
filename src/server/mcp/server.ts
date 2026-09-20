import "server-only";
import {
  ERROR_CODES,
  failure,
  isNotification,
  negotiateVersion,
  SERVER_INFO,
  success,
  toolError,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "@/server/mcp/protocol";
import { describeTools, TOOLS_BY_NAME } from "@/server/mcp/tools";

/**
 * Dispatches one JSON-RPC message. Returns null for a notification, which the
 * transport answers with 202 and no body.
 */
export async function handleMessage(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return failure(message.id ?? null, ERROR_CODES.invalidRequest, "Not a JSON-RPC 2.0 message");
  }

  if (isNotification(message)) {
    // initialized, cancelled, and friends need no answer.
    return null;
  }

  const id = message.id ?? null;

  switch (message.method) {
    case "initialize":
      return success(id, {
        protocolVersion: negotiateVersion(message.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Bothy holds structured IT documentation: companies, their locations, and " +
          "documents built from templates. Search first, then read the document you " +
          "need. Credentials are never returned; a secret field only says that one " +
          "exists.",
      });

    case "ping":
      return success(id, {});

    case "tools/list":
      return success(id, { tools: describeTools() });

    case "tools/call": {
      const name = message.params?.name;
      if (typeof name !== "string") {
        return failure(id, ERROR_CODES.invalidParams, "A tool name is required");
      }

      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) return failure(id, ERROR_CODES.invalidParams, `Unknown tool: ${name}`);

      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;

      try {
        return success(id, await tool.run(args));
      } catch (error) {
        // A failure inside a tool is a result, not a protocol error, so the
        // model can read it. The message never carries internals.
        console.error(`bothy: MCP tool ${name} failed`, error);
        return success(id, toolError(`The ${name} tool failed. Check the server logs.`));
      }
    }

    default:
      return failure(id, ERROR_CODES.methodNotFound, `Unknown method: ${message.method}`);
  }
}
