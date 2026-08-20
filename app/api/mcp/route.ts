import { createMcpHandler } from "@modelcontextprotocol/server";

import { createBookmarkMcpServer } from "@/lib/bookmarks/mcp-server";
import {
  authenticateBookmarkMcpRequest,
  insufficientScopeResponse,
  type McpPrincipal,
} from "@/lib/mcp-auth/authenticate";
import {
  type BookmarkScope,
  validateMcpRequestHost,
  validateMcpRequestOrigin,
} from "@/lib/mcp-auth/metadata";
import { checkBookmarkMcpRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1024 * 1024;

function withMcpHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Authorization, Cookie, Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonGuardResponse(status: number, error: string) {
  return withMcpHeaders(Response.json({ error }, { status }));
}

async function parseBoundedBody(request: Request): Promise<unknown | Response> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return jsonGuardResponse(413, "Request body too large");
  }
  if (!request.body) return undefined;
  const reader = request.clone().body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return jsonGuardResponse(413, "Request body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function requiredScope(body: unknown): BookmarkScope | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const request = body as { method?: unknown; params?: unknown };
  if (request.method === "server/discover" || request.method === "tools/list") {
    return "bookmarks:read";
  }
  if (request.method !== "tools/call" || !request.params || typeof request.params !== "object") return null;
  const name = (request.params as { name?: unknown }).name;
  if (name === "add_bookmark" || name === "delete_bookmark") return "bookmarks:write";
  if (name === "list_bookmarks" || name === "search_bookmarks") return "bookmarks:read";
  return null;
}

function hasScope(principal: McpPrincipal, scope: BookmarkScope) {
  return principal.authKind === "session" || principal.scopes.has(scope);
}

export async function POST(request: Request) {
  if (!validateMcpRequestHost(request) || !validateMcpRequestOrigin(request)) {
    return jsonGuardResponse(403, "Forbidden");
  }

  const authentication = await authenticateBookmarkMcpRequest(request);
  if (authentication instanceof Response) return withMcpHeaders(authentication);
  await checkBookmarkMcpRateLimit({
    userId: authentication.userId,
    authKind: authentication.authKind,
  });

  const parsedBody = await parseBoundedBody(request);
  if (parsedBody instanceof Response) return parsedBody;
  const scope = requiredScope(parsedBody);
  if (scope && !hasScope(authentication, scope)) {
    return withMcpHeaders(insufficientScopeResponse(scope));
  }

  const handler = createMcpHandler(() => createBookmarkMcpServer(authentication), {
    // Current desktop clients still commonly initialize with a 2025 MCP
    // revision. Serve that handshake through the SDK's stateless Streamable
    // HTTP compatibility path so clients do not fall back to legacy SSE.
    legacy: "stateless",
    responseMode: "json",
    onerror(error) {
      console.error(JSON.stringify({ event: "mcp.request.failed", category: error.name || "unknown" }));
    },
  });
  const response = await handler.fetch(request, {
    ...(parsedBody === undefined ? {} : { parsedBody }),
    ...(authentication.authInfo ? { authInfo: authentication.authInfo } : {}),
  });
  return withMcpHeaders(response);
}
