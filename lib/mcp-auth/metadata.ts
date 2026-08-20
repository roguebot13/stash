import "server-only";

import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/server";

import { getServerEnv } from "@/lib/env";

export const BOOKMARK_SCOPES = ["bookmarks:read", "bookmarks:write"] as const;
export type BookmarkScope = (typeof BOOKMARK_SCOPES)[number];

export function getBookmarkMcpConfiguration() {
  const env = getServerEnv();
  const appOrigin = new URL(env.APP_URL).origin;
  const resource = new URL("/api/mcp", appOrigin);
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
  return {
    appOrigin,
    trustedHost: new URL(appOrigin).host.toLowerCase(),
    issuer: env.MCP_AUTH_ISSUER,
    resource,
    metadataUrl,
  } as const;
}

export function buildBookmarkProtectedResourceMetadata() {
  const config = getBookmarkMcpConfiguration();
  return {
    resource: config.resource.href,
    authorization_servers: [config.issuer],
    scopes_supported: [...BOOKMARK_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Stash bookmarks MCP",
  } as const;
}

function normalizedRequestHost(request: Request) {
  const rawHost = request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(`http://${rawHost}`).host.toLowerCase();
  } catch {
    return null;
  }
}

export function validateMcpRequestHost(request: Request) {
  return normalizedRequestHost(request) === getBookmarkMcpConfiguration().trustedHost;
}

export function validateMcpRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    return new URL(origin).origin === getBookmarkMcpConfiguration().appOrigin;
  } catch {
    return false;
  }
}
