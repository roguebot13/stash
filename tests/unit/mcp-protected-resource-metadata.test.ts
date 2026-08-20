import { beforeEach, describe, expect, it } from "vitest";

import { resetEnvCacheForTests } from "@/lib/env";
import {
  buildBookmarkProtectedResourceMetadata,
  getBookmarkMcpConfiguration,
  validateMcpRequestHost,
  validateMcpRequestOrigin,
} from "@/lib/mcp-auth/metadata";

describe("MCP protected-resource metadata", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_SECRET = "x".repeat(32);
    process.env.APP_URL = "https://stash.example";
    process.env.MCP_AUTH_ISSUER = "https://auth.example/tenant";
    process.env.EMAIL_FROM = "Stash <hello@stash.example>";
    resetEnvCacheForTests();
  });

  it("derives exact trusted resource and metadata values", () => {
    expect(getBookmarkMcpConfiguration()).toMatchObject({
      appOrigin: "https://stash.example",
      issuer: "https://auth.example/tenant",
      metadataUrl: "https://stash.example/.well-known/oauth-protected-resource/api/mcp",
    });
    expect(buildBookmarkProtectedResourceMetadata()).toEqual({
      resource: "https://stash.example/api/mcp",
      authorization_servers: ["https://auth.example/tenant"],
      scopes_supported: ["bookmarks:read", "bookmarks:write"],
      bearer_methods_supported: ["header"],
      resource_name: "Stash bookmarks MCP",
    });
  });

  it("does not reflect request hosts or origins", () => {
    const valid = new Request("https://stash.example/api/mcp", {
      headers: { host: "stash.example", origin: "https://stash.example" },
    });
    const badHost = new Request("https://evil.example/api/mcp", { headers: { host: "evil.example" } });
    const prefixOrigin = new Request("https://stash.example/api/mcp", {
      headers: { host: "stash.example", origin: "https://stash.example.evil.test" },
    });
    expect(validateMcpRequestHost(valid)).toBe(true);
    expect(validateMcpRequestOrigin(valid)).toBe(true);
    expect(validateMcpRequestHost(badHost)).toBe(false);
    expect(validateMcpRequestOrigin(prefixOrigin)).toBe(false);
  });

  it("preserves the configured issuer for exact token and metadata comparison", () => {
    process.env.MCP_AUTH_ISSUER = "https://auth.example/tenant/";
    resetEnvCacheForTests();
    expect(getBookmarkMcpConfiguration().issuer).toBe("https://auth.example/tenant/");
    expect(buildBookmarkProtectedResourceMetadata().authorization_servers).toEqual([
      "https://auth.example/tenant/",
    ]);
  });
});
