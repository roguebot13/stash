import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMCPClient: vi.fn(),
  tools: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: mocks.createMCPClient }));

import { bookmarkToolSchemas, connectBookmarkTools } from "@/lib/ai/mcp-client";

describe("AI SDK MCP client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createMCPClient.mockResolvedValue({ tools: mocks.tools, close: mocks.close });
    mocks.tools.mockResolvedValue({
      add_bookmark: {},
      list_bookmarks: {},
      search_bookmarks: {},
      delete_bookmark: {},
    });
    mocks.close.mockResolvedValue(undefined);
  });

  it("uses the fixed same-origin endpoint and explicit tool schemas", async () => {
    const connection = await connectBookmarkTools({
      appOrigin: "https://stash.example",
      cookie: "authjs.session-token=secret",
    });

    expect(mocks.createMCPClient).toHaveBeenCalledWith(expect.objectContaining({
      clientName: "stash-chat",
      transport: expect.objectContaining({
        type: "http",
        url: "https://stash.example/api/mcp",
        redirect: "error",
        headers: {
          Cookie: "authjs.session-token=secret",
          Origin: "https://stash.example",
        },
      }),
    }));
    expect(mocks.tools).toHaveBeenCalledWith({ schemas: bookmarkToolSchemas });
    await connection.close();
    await connection.close();
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it("fails closed and closes when a required tool is missing", async () => {
    mocks.tools.mockResolvedValue({ add_bookmark: {}, list_bookmarks: {}, search_bookmarks: {} });
    await expect(connectBookmarkTools({ appOrigin: "https://stash.example", cookie: "session=x" })).rejects.toThrow(
      "Required MCP tools are unavailable",
    );
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
