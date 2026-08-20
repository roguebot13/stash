import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  McpInvalidTokenError,
  McpJwtTokenVerifier,
} from "@/lib/mcp-auth/token-verifier";

const issuer = "http://127.0.0.1:4000";
const resource = new URL("http://localhost:3000/api/mcp");
const nowSeconds = 1_787_225_600;

describe("MCP JWT access-token verifier", () => {
  let privateKey: CryptoKey;
  let jwk: Awaited<ReturnType<typeof exportJWK>>;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    jwk = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "RS256", use: "sig" };
  });

  function fetchImpl(input: string | URL | Request) {
    const url = input instanceof Request ? input.url : input.toString();
    const body = url.endsWith("/.well-known/oauth-authorization-server")
      ? {
          issuer,
          jwks_uri: `${issuer}/keys`,
          access_token_signing_alg_values_supported: ["RS256"],
        }
      : { keys: [jwk] };
    return Promise.resolve(Response.json(body));
  }

  function verifier(userVersion = 3) {
    return new McpJwtTokenVerifier({
      issuer,
      resource,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => nowSeconds * 1000,
      findUserVersion: async (id) =>
        id === "alice" ? { id, sessionVersion: userVersion, emailVerifiedAt: new Date() } : null,
    });
  }

  async function token(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
    return new SignJWT({
      iss: issuer,
      sub: "alice",
      aud: resource.href,
      iat: nowSeconds,
      exp: nowSeconds + 600,
      scope: "bookmarks:read bookmarks:write",
      client_id: "client-1",
      stash_session_version: 3,
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", typ: "at+jwt", kid: "key-1", ...header })
      .sign(privateKey);
  }

  it("accepts a correctly bound token and maps the existing local user", async () => {
    const raw = await token();
    await expect(verifier().verifyAccessToken(raw)).resolves.toEqual({
      token: raw,
      clientId: "client-1",
      scopes: ["bookmarks:read", "bookmarks:write"],
      expiresAt: nowSeconds + 600,
      resource,
      extra: { userId: "alice" },
    });
  });

  it.each([
    [{ aud: "http://localhost:3000/other" }, {}],
    [{ aud: [resource.href, "https://other.example/api"] }, {}],
    [{ stash_session_version: 2 }, {}],
    [{ scope: " bookmarks:read" }, {}],
    [{ client_id: "", azp: "" }, {}],
    [{}, { typ: "JWT" }],
    [{}, { kid: "missing" }],
  ])("rejects invalid claims or protected headers", async (claims, header) => {
    await expect(verifier().verifyAccessToken(await token(claims, header))).rejects.toBeInstanceOf(
      McpInvalidTokenError,
    );
  });

  it("rejects unknown users and stale session versions", async () => {
    await expect(verifier(4).verifyAccessToken(await token())).rejects.toBeInstanceOf(McpInvalidTokenError);
    await expect(verifier().verifyAccessToken(await token({ sub: "missing" }))).rejects.toBeInstanceOf(
      McpInvalidTokenError,
    );
  });

  it("rejects a pending local account", async () => {
    const pending = new McpJwtTokenVerifier({
      issuer,
      resource,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => nowSeconds * 1000,
      findUserVersion: async (id) => ({ id, sessionVersion: 3, emailVerifiedAt: null }),
    });
    await expect(pending.verifyAccessToken(await token())).rejects.toBeInstanceOf(McpInvalidTokenError);
  });

  it("rejects access-token lifetimes over 60 minutes", async () => {
    const longLived = await new SignJWT({
      scope: "bookmarks:read",
      client_id: "client-1",
      stash_session_version: 3,
    })
      .setProtectedHeader({ alg: "RS256", typ: "at+jwt", kid: "key-1" })
      .setIssuer(issuer)
      .setSubject("alice")
      .setAudience(resource.href)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 3_601)
      .sign(privateKey);
    await expect(verifier().verifyAccessToken(longLived)).rejects.toBeInstanceOf(McpInvalidTokenError);
  });
});
