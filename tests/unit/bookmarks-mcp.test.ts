import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addBookmark, listBookmarks, searchBookmarks, deleteBookmark } = vi.hoisted(() => ({
  addBookmark: vi.fn(),
  listBookmarks: vi.fn(),
  searchBookmarks: vi.fn(),
  deleteBookmark: vi.fn(),
}));

vi.mock("@/lib/bookmarks/dal", () => ({
  addBookmark,
  listBookmarks,
  searchBookmarks,
  deleteBookmark,
}));

import { createBookmarkMcpServer } from "@/lib/bookmarks/mcp-server";

const principal = {
  userId: "alice",
  authKind: "session" as const,
  scopes: new Set(["bookmarks:read" as const, "bookmarks:write" as const]),
};

function modernRequest(method: string, params: Record<string, unknown>, name?: string) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
        [CLIENT_INFO_META_KEY]: { name: "test-client", version: "1.0.0" },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    },
  };
  return new Request("https://stash.example/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(name ? { "Mcp-Name": name } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("bookmark MCP server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function handler() {
    return createMcpHandler(() => createBookmarkMcpServer(principal), {
      legacy: "reject",
      responseMode: "json",
    });
  }

  it("advertises exactly four tools in deterministic order with schemas and annotations", async () => {
    const response = await handler().fetch(modernRequest("tools/list", {}));
    expect(response.status).toBe(200);
    const payload = await response.json();
    const tools = payload.result.tools;
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
      "add_bookmark",
      "list_bookmarks",
      "search_bookmarks",
      "delete_bookmark",
    ]);
    expect(tools[0]).toMatchObject({
      title: "Add bookmark",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    expect(tools.every((tool: { inputSchema?: unknown; outputSchema?: unknown }) => tool.inputSchema && tool.outputSchema)).toBe(
      true,
    );
    expect(tools[0].inputSchema.additionalProperties).toBe(false);
    expect(tools[0].outputSchema.additionalProperties).toBe(false);
  });

  it("returns matching structured and JSON text content for a successful tool call", async () => {
    const output = {
      bookmark: {
        id: "cm123",
        url: "https://example.com/",
        title: "Example",
        tags: ["reference"],
        notes: null,
        created_at: "2026-08-20T12:34:56.789Z",
      },
      created: true,
    };
    addBookmark.mockResolvedValue(output);
    const response = await handler().fetch(
      modernRequest(
        "tools/call",
        { name: "add_bookmark", arguments: { url: "https://example.com", title: "Example" } },
        "add_bookmark",
      ),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.structuredContent).toEqual(output);
    expect(JSON.parse(payload.result.content[0].text)).toEqual(output);
    expect(addBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "alice" }),
      expect.objectContaining({ url: "https://example.com/", title: "Example", tags: [], notes: null }),
    );
  });
});
