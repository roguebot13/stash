import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  connectBookmarkTools: vi.fn(),
  validateHost: vi.fn(),
  validateOrigin: vi.fn(),
}));

vi.mock("@/lib/auth-dal", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/ai/mcp-client", () => ({ connectBookmarkTools: mocks.connectBookmarkTools }));
vi.mock("@/lib/ai/config", () => ({ getChatModel: vi.fn(), STASH_ASSISTANT_INSTRUCTIONS: "test" }));
vi.mock("@/lib/mcp-auth/metadata", () => ({
  validateAppRequestHost: mocks.validateHost,
  validateAppRequestOrigin: mocks.validateOrigin,
  getBookmarkMcpConfiguration: () => ({ appOrigin: "https://stash.example" }),
}));

import { POST } from "@/app/api/chat/route";

function request(options?: { origin?: string; cookie?: string }) {
  return new Request("https://stash.example/api/chat", {
    method: "POST",
    headers: {
      host: "stash.example",
      origin: options?.origin ?? "https://stash.example",
      "Content-Type": "application/json",
      ...(options?.cookie ? { cookie: options.cookie } : {}),
    },
    body: JSON.stringify({
      id: "chat",
      messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
      trigger: "submit-message",
    }),
  });
}

describe("chat route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateHost.mockReturnValue(true);
    mocks.validateOrigin.mockReturnValue(true);
    mocks.requireApiUser.mockResolvedValue({ ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) });
  });

  it("rejects an untrusted origin before authentication or MCP work", async () => {
    mocks.validateOrigin.mockReturnValue(false);
    const response = await POST(request({ origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
    expect(mocks.connectBookmarkTools).not.toHaveBeenCalled();
  });

  it("rejects an invalid session before body parsing or MCP work", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.connectBookmarkTools).not.toHaveBeenCalled();
  });

  it("requires a cookie even after the independently validated session", async () => {
    mocks.requireApiUser.mockResolvedValue({ ok: true, user: { id: "alice", email: "alice@example.com" } });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.connectBookmarkTools).not.toHaveBeenCalled();
  });

  it("maps MCP initialization failures to a safe 503", async () => {
    mocks.requireApiUser.mockResolvedValue({ ok: true, user: { id: "alice", email: "alice@example.com" } });
    mocks.connectBookmarkTools.mockRejectedValue(new Error("secret transport details"));
    const response = await POST(request({ cookie: "authjs.session-token=secret" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Bookmark tools are temporarily unavailable" });
  });

  it("rejects an invalid body before opening the MCP connection", async () => {
    mocks.requireApiUser.mockResolvedValue({ ok: true, user: { id: "alice", email: "alice@example.com" } });
    const invalid = new Request("https://stash.example/api/chat", {
      method: "POST",
      headers: { host: "stash.example", origin: "https://stash.example", cookie: "session=x", "Content-Type": "application/json" },
      body: "{not-json",
    });
    const response = await POST(invalid);
    expect(response.status).toBe(400);
    expect(mocks.connectBookmarkTools).not.toHaveBeenCalled();
  });
});
