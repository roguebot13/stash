import "server-only";

import {
  bearerAuthChallengeResponse,
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import { requireApiUser } from "@/lib/auth-dal";
import {
  BOOKMARK_SCOPES,
  type BookmarkScope,
  getBookmarkMcpConfiguration,
} from "@/lib/mcp-auth/metadata";
import {
  getMcpTokenVerifier,
  McpTokenVerifierUnavailableError,
} from "@/lib/mcp-auth/token-verifier";

export type McpPrincipal = Readonly<{
  userId: string;
  authKind: "session" | "bearer";
  scopes: ReadonlySet<BookmarkScope>;
  authInfo?: AuthInfo;
}>;

function challengeOptions(requiredScopes: readonly BookmarkScope[]) {
  return {
    requiredScopes: [...requiredScopes],
    resourceMetadataUrl: getBookmarkMcpConfiguration().metadataUrl,
  };
}

export function missingCredentialsResponse() {
  const config = getBookmarkMcpConfiguration();
  return Response.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${config.metadataUrl}", scope="bookmarks:read"`,
      },
    },
  );
}

export function invalidTokenResponse() {
  return bearerAuthChallengeResponse(
    new OAuthError(OAuthErrorCode.InvalidToken, "The access token is invalid or expired."),
    challengeOptions(["bookmarks:read"]),
  );
}

export function insufficientScopeResponse(requiredScope: BookmarkScope) {
  return bearerAuthChallengeResponse(
    new OAuthError(OAuthErrorCode.InsufficientScope, "The access token lacks the required scope."),
    challengeOptions([requiredScope]),
  );
}

function unavailableResponse() {
  return Response.json(
    { error: "temporarily_unavailable", message: "Token verification is temporarily unavailable." },
    { status: 503, headers: { "Retry-After": "30" } },
  );
}

function bearerTokenFromRequest(request: Request) {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer ([^\s,]+)$/.exec(header);
  return match?.[1] ?? false;
}

export async function authenticateBookmarkMcpRequest(
  request: Request,
  verifier: OAuthTokenVerifier = getMcpTokenVerifier(),
): Promise<McpPrincipal | Response> {
  const bearerToken = bearerTokenFromRequest(request);
  if (bearerToken !== null) {
    if (bearerToken === false) return invalidTokenResponse();
    try {
      const authInfo = await verifier.verifyAccessToken(bearerToken);
      const userId = authInfo.extra?.userId;
      if (typeof userId !== "string" || !userId) return invalidTokenResponse();
      const scopes = new Set(
        authInfo.scopes.filter((scope): scope is BookmarkScope =>
          (BOOKMARK_SCOPES as readonly string[]).includes(scope),
        ),
      );
      return Object.freeze({ userId, authKind: "bearer" as const, scopes, authInfo });
    } catch (error) {
      if (error instanceof McpTokenVerifierUnavailableError) return unavailableResponse();
      return invalidTokenResponse();
    }
  }

  const session = await requireApiUser();
  if (!session.ok) return missingCredentialsResponse();
  return Object.freeze({
    userId: session.user.id,
    authKind: "session" as const,
    scopes: new Set<BookmarkScope>(BOOKMARK_SCOPES),
  });
}
