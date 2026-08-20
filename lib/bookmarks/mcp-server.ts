import "server-only";

import { McpServer } from "@modelcontextprotocol/server";

import packageJson from "@/package.json";
import {
  addBookmark,
  deleteBookmark,
  listBookmarks,
  searchBookmarks,
} from "@/lib/bookmarks/dal";
import { InvalidBookmarkCursorError } from "@/lib/bookmarks/cursor";
import {
  addBookmarkInputSchema,
  addBookmarkOutputSchema,
  bookmarkPageOutputSchema,
  deleteBookmarkInputSchema,
  deleteBookmarkOutputSchema,
  listBookmarksInputSchema,
  searchBookmarksInputSchema,
} from "@/lib/bookmarks/schemas";
import type { McpPrincipal } from "@/lib/mcp-auth/authenticate";
import type { BookmarkScope } from "@/lib/mcp-auth/metadata";

type ToolName = "add_bookmark" | "list_bookmarks" | "search_bookmarks" | "delete_bookmark";

const successEventByTool: Record<ToolName, string> = {
  add_bookmark: "bookmark.add.succeeded",
  list_bookmarks: "bookmark.list.succeeded",
  search_bookmarks: "bookmark.search.succeeded",
  delete_bookmark: "bookmark.delete.succeeded",
};

function assertScope(principal: McpPrincipal, scope: BookmarkScope) {
  if (!principal.scopes.has(scope)) throw new Error("MCP scope assertion failed");
}

function successResult(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function errorResult(code: "INVALID_CURSOR" | "INTERNAL_ERROR", message: string) {
  const value = { error: { code, message } };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

async function runTool<T extends Record<string, unknown>>(
  principal: McpPrincipal,
  tool: ToolName,
  operation: () => Promise<T>,
) {
  const startedAt = performance.now();
  try {
    const value = await operation();
    console.info(
      JSON.stringify({
        event: successEventByTool[tool],
        userId: principal.userId,
        authKind: principal.authKind,
        tool,
        durationMs: Math.round(performance.now() - startedAt),
        ...(Array.isArray(value.bookmarks) ? { resultCount: value.bookmarks.length } : {}),
        ...(typeof value.created === "boolean" ? { created: value.created } : {}),
        ...(typeof value.deleted === "boolean" ? { deleted: value.deleted } : {}),
      }),
    );
    return successResult(value);
  } catch (error) {
    if (error instanceof InvalidBookmarkCursorError) {
      return errorResult("INVALID_CURSOR", "The bookmark cursor is invalid.");
    }
    console.error(
      JSON.stringify({
        event: "bookmark.operation.failed",
        userId: principal.userId,
        authKind: principal.authKind,
        tool,
        durationMs: Math.round(performance.now() - startedAt),
        category: "database_or_internal",
      }),
    );
    return errorResult("INTERNAL_ERROR", "The bookmark operation could not be completed.");
  }
}

export function createBookmarkMcpServer(principal: McpPrincipal) {
  const server = new McpServer(
    { name: "stash-bookmarks", version: packageJson.version },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "add_bookmark",
    {
      title: "Add bookmark",
      description:
        "Save an HTTP or HTTPS bookmark in the authenticated user's Stash collection. An existing canonical URL is returned unchanged.",
      inputSchema: addBookmarkInputSchema,
      outputSchema: addBookmarkOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      assertScope(principal, "bookmarks:write");
      return runTool(principal, "add_bookmark", () => addBookmark(principal, input));
    },
  );

  server.registerTool(
    "list_bookmarks",
    {
      title: "List bookmarks",
      description: "List the authenticated user's bookmarks in newest-first order with cursor pagination.",
      inputSchema: listBookmarksInputSchema,
      outputSchema: bookmarkPageOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      assertScope(principal, "bookmarks:read");
      return runTool(principal, "list_bookmarks", () => listBookmarks(principal, input));
    },
  );

  server.registerTool(
    "search_bookmarks",
    {
      title: "Search bookmarks",
      description: "Search the authenticated user's bookmark titles, URLs, notes, and tags with cursor pagination.",
      inputSchema: searchBookmarksInputSchema,
      outputSchema: bookmarkPageOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      assertScope(principal, "bookmarks:read");
      return runTool(principal, "search_bookmarks", () => searchBookmarks(principal, input));
    },
  );

  server.registerTool(
    "delete_bookmark",
    {
      title: "Delete bookmark",
      description: "Delete a bookmark only when it belongs to the authenticated user.",
      inputSchema: deleteBookmarkInputSchema,
      outputSchema: deleteBookmarkOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      assertScope(principal, "bookmarks:write");
      return runTool(principal, "delete_bookmark", () => deleteBookmark(principal, input));
    },
  );

  return server;
}
