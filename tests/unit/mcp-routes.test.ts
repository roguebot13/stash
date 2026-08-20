import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  verifyAccessToken: vi.fn(),
}));

vi.mock("@/lib/auth-dal", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/mcp-auth/token-verifier", () => {
  class McpTokenVerifierUnavailableError extends Error {}
  return {
    McpTokenVerifierUnavailableError,
    getMcpTokenVerifier: () => ({ verifyAccessToken: mocks.verifyAccessToken }),
  };
});
vi.mock("@/lib/bookmarks/dal", () => ({
  addBookmark: vi.fn(),
  listBookmarks: vi.fn(),
  searchBookmarks: vi.fn(),
  deleteBookmark: vi.fn(),
}));

import { POST } from "@/app/api/mcp/route";
import { GET as METADATA_GET, HEAD as METADATA_HEAD } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { resetEnvCacheForTests } from "@/lib/env";

function modernBody(method: string, params: Record<string, unknown> = {}) {
  return JSON.stringify({
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
  });
}

function mcpRequest(options?: {
  host?: string;
  origin?: string;
  authorization?: string;
  method?: string;
  params?: Record<string, unknown>;
  toolName?: string;
  rawBody?: string;
}) {
  const method = options?.method ?? "tools/list";
  return new Request("https://stash.example/api/mcp", {
    method: "POST",
    headers: {
      host: options?.host ?? "stash.example",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(options?.origin ? { origin: options.origin } : {}),
      ...(options?.authorization ? { authorization: options.authorization } : {}),
      ...(options?.toolName ? { "Mcp-Name": options.toolName } : {}),
    },
    body: options?.rawBody ?? modernBody(method, options?.params),
  });
}

function bearer(scopes: string[]): AuthInfo {
  return {
    token: "fixture-token",
    clientId: "client-1",
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    resource: new URL("https://stash.example/api/mcp"),
    extra: { userId: "alice" },
  };
}

describe("MCP routes", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_SECRET = "x".repeat(32);
    process.env.APP_URL = "https://stash.example";
    process.env.MCP_AUTH_ISSUER = "https://auth.example";
    process.env.EMAIL_FROM = "Stash <hello@stash.example>";
    resetEnvCacheForTests();
    mocks.requireApiUser.mockReset();
    mocks.verifyAccessToken.mockReset();
    mocks.requireApiUser.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
  });

  it("authenticates before parsing malformed JSON and returns the OAuth-aware challenge", async () => {
    const response = await POST(mcpRequest({ rawBody: "{not-json" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://stash.example/.well-known/oauth-protected-resource/api/mcp"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie, Origin");
  });

  it("rejects host and origin mismatches before authentication", async () => {
    expect((await POST(mcpRequest({ host: "evil.example" }))).status).toBe(403);
    expect((await POST(mcpRequest({ origin: "https://stash.example.evil.test" }))).status).toBe(403);
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
    expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("does not fall back to a cookie when a supplied bearer token is invalid", async () => {
    mocks.requireApiUser.mockResolvedValue({ ok: true, user: { id: "alice", email: "alice@example.com" } });
    mocks.verifyAccessToken.mockRejectedValue(new Error("invalid"));
    const response = await POST(mcpRequest({ authorization: "Bearer bad-token" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
  });

  it("accepts a valid remote bearer request without Origin and enforces exact scopes", async () => {
    mocks.verifyAccessToken.mockResolvedValue(bearer(["bookmarks:read"]));
    const listResponse = await POST(mcpRequest({ authorization: "Bearer fixture-token" }));
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("access-control-allow-origin")).toBeNull();
    const listPayload = await listResponse.json();
    expect(listPayload.result.tools).toHaveLength(4);

    const addResponse = await POST(
      mcpRequest({
        authorization: "Bearer fixture-token",
        method: "tools/call",
        toolName: "add_bookmark",
        params: { name: "add_bookmark", arguments: { url: "https://example.com", title: "Example" } },
      }),
    );
    expect(addResponse.status).toBe(403);
    expect(addResponse.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(addResponse.headers.get("www-authenticate")).toContain('scope="bookmarks:write"');
  });

  it("does not treat a longer unknown scope as the required read scope", async () => {
    mocks.verifyAccessToken.mockResolvedValue(bearer(["bookmarks:read-extra"]));
    const response = await POST(mcpRequest({ authorization: "Bearer fixture-token" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('scope="bookmarks:read"');
  });

  it("serves public host-validated protected-resource metadata with read-only CORS", async () => {
    const request = new Request(
      "https://stash.example/.well-known/oauth-protected-resource/api/mcp?ignored=1",
      { headers: { host: "stash.example" } },
    );
    const response = await METADATA_GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.json()).toEqual({
      resource: "https://stash.example/api/mcp",
      authorization_servers: ["https://auth.example"],
      scopes_supported: ["bookmarks:read", "bookmarks:write"],
      bearer_methods_supported: ["header"],
      resource_name: "Stash bookmarks MCP",
    });
    const head = await METADATA_HEAD(request);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(
      (await METADATA_GET(new Request(request.url, { headers: { host: "evil.example" } }))).status,
    ).toBe(403);
  });
});
