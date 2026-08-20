import "server-only";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

import {
  addBookmarkInputSchema,
  addBookmarkOutputSchema,
  bookmarkPageOutputSchema,
  deleteBookmarkInputSchema,
  deleteBookmarkOutputSchema,
  listBookmarksInputSchema,
  searchBookmarksInputSchema,
} from "@/lib/bookmarks/schemas";

export const bookmarkToolSchemas = {
  add_bookmark: {
    inputSchema: addBookmarkInputSchema,
    outputSchema: addBookmarkOutputSchema,
  },
  list_bookmarks: {
    inputSchema: listBookmarksInputSchema,
    outputSchema: bookmarkPageOutputSchema,
  },
  search_bookmarks: {
    inputSchema: searchBookmarksInputSchema,
    outputSchema: bookmarkPageOutputSchema,
  },
  delete_bookmark: {
    inputSchema: deleteBookmarkInputSchema,
    outputSchema: deleteBookmarkOutputSchema,
  },
} as const;

export async function connectBookmarkTools(options: {
  appOrigin: string;
  cookie: string;
}) {
  const mcpUrl = new URL("/api/mcp", options.appOrigin);
  let client: MCPClient | undefined;
  let closed = false;

  async function close() {
    if (closed) return;
    closed = true;
    await client?.close();
  }

  try {
    client = await createMCPClient({
      clientName: "stash-chat",
      version: "0.1.0",
      transport: {
        type: "http",
        url: mcpUrl.href,
        redirect: "error",
        headers: {
          Cookie: options.cookie,
          Origin: options.appOrigin,
        },
      },
    });
    const tools = await client.tools({ schemas: bookmarkToolSchemas });
    const expected = Object.keys(bookmarkToolSchemas);
    if (expected.some((name) => !(name in tools)) || Object.keys(tools).length !== expected.length) {
      throw new Error("Required MCP tools are unavailable");
    }
    return { tools, close };
  } catch (error) {
    await close();
    throw error;
  }
}
