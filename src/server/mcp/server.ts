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
import { canUse, describeTools, TOOLS_BY_NAME, type McpCaller } from "@/server/mcp/tools";

/**
 * Dispatches one JSON-RPC message. Returns null for a notification, which the
 * transport answers with 202 and no body.
 */
export async function handleMessage(
  message: JsonRpcRequest,
  caller: McpCaller,
): Promise<JsonRpcResponse | null> {
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
          "Trove KB holds structured IT documentation: companies, their locations, and " +
          "documents built from templates. Search first, then read the document you " +
          "need. Credentials are never returned; a secret field only says that one " +
          "exists. Knowledge base collections hold reference articles from outside " +
          "sources, separate from client documentation: search them with search_kb " +
          "and cite each article's source_url." +
          (caller.grants.some((grant) => grant.canWrite)
            ? " This connection may also maintain some collections: list_kb_collections " +
              "marks them writable. Before writing, call list_kb_articles to see what " +
              "exists. Give every article a stable external_id, such as a path-like " +
              "slug, and reuse it when the article changes so it is updated rather than " +
              "duplicated. Archive an article that no longer applies."
            : ""),
      });

    case "ping":
      return success(id, {});

    case "tools/list":
      return success(id, { tools: describeTools(caller) });

    case "tools/call": {
      const name = message.params?.name;
      if (typeof name !== "string") {
        return failure(id, ERROR_CODES.invalidParams, "A tool name is required");
      }

      const tool = TOOLS_BY_NAME.get(name);
      // A tool this key was not offered does not exist, as far as it can tell.
      if (!tool || !canUse(tool, caller)) {
        return failure(id, ERROR_CODES.invalidParams, `Unknown tool: ${name}`);
      }

      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;

      try {
        return success(id, await tool.run(args, caller.scope, caller));
      } catch (error) {
        // A failure inside a tool is a result, not a protocol error, so the
        // model can read it. The message never carries internals.
        console.error(`trove-kb: MCP tool ${name} failed`, error);
        return success(id, toolError(`The ${name} tool failed. Check the server logs.`));
      }
    }

    default:
      return failure(id, ERROR_CODES.methodNotFound, `Unknown method: ${message.method}`);
  }
}
