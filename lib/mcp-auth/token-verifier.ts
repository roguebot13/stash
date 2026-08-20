import "server-only";

import type { AuthInfo, OAuthTokenVerifier } from "@modelcontextprotocol/server";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";
import { z } from "zod";

import { getBookmarkMcpConfiguration } from "@/lib/mcp-auth/metadata";

const ALLOWED_ALGORITHMS = ["RS256", "ES256"] as const;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_DOCUMENT_BYTES = 256 * 1024;
const METADATA_TTL_MS = 5 * 60_000;
const JWKS_TTL_MS = 5 * 60_000;
const CLOCK_TOLERANCE_SECONDS = 60;
const MAX_TOKEN_LIFETIME_SECONDS = 60 * 60;

const authorizationServerMetadataSchema = z
  .object({
    issuer: z.string().url(),
    jwks_uri: z.string().url(),
    access_token_signing_alg_values_supported: z.array(z.string()).min(1),
  })
  .passthrough();

const jwksSchema = z.object({ keys: z.array(z.record(z.string(), z.unknown())).max(100) }).strict();

type FetchLike = typeof fetch;
type UserVersionLookup = (id: string) => Promise<{ id: string; sessionVersion: number } | null>;

type CacheEntry<T> = { value: T; expiresAt: number };

export class McpTokenVerifierUnavailableError extends Error {
  constructor() {
    super("MCP token verification dependencies are unavailable");
    this.name = "McpTokenVerifierUnavailableError";
  }
}

export class McpInvalidTokenError extends Error {
  constructor() {
    super("Invalid access token");
    this.name = "McpInvalidTokenError";
  }
}

function isLoopbackUrl(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

function validateFetchUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new McpTokenVerifierUnavailableError();
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && isLoopbackUrl(url))) {
    throw new McpTokenVerifierUnavailableError();
  }
  return url;
}

async function readBoundedJson(response: Response) {
  if (!response.ok) throw new McpTokenVerifierUnavailableError();
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" && contentType !== "application/jwk-set+json") {
    throw new McpTokenVerifierUnavailableError();
  }
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_DOCUMENT_BYTES) {
    throw new McpTokenVerifierUnavailableError();
  }
  if (!response.body) throw new McpTokenVerifierUnavailableError();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new McpTokenVerifierUnavailableError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new McpTokenVerifierUnavailableError();
  }
}

function discoveryUrls(issuer: URL) {
  const issuerPath = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  return [
    new URL(`/.well-known/oauth-authorization-server${issuerPath}`, issuer.origin),
    new URL(`${issuer.href.replace(/\/$/, "")}/.well-known/openid-configuration`),
  ];
}

function validAudience(audience: JWTPayload["aud"], resource: string) {
  return audience === resource || (Array.isArray(audience) && audience.length === 1 && audience[0] === resource);
}

function parseScopes(scope: unknown) {
  if (typeof scope !== "string") throw new McpInvalidTokenError();
  if (scope === "") return [];
  if (scope.trim() !== scope || scope.includes("  ")) throw new McpInvalidTokenError();
  const scopes = scope.split(" ");
  if (scopes.some((item) => !/^[\u0021\u0023-\u005B\u005D-\u007E]+$/.test(item))) {
    throw new McpInvalidTokenError();
  }
  return [...new Set(scopes)];
}

export type McpJwtTokenVerifierOptions = {
  issuer: string;
  resource: URL;
  fetchImpl?: FetchLike;
  now?: () => number;
  findUserVersion?: UserVersionLookup;
};

export class McpJwtTokenVerifier implements OAuthTokenVerifier {
  private readonly issuerValue: string;
  private readonly issuer: URL;
  private readonly resource: URL;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly findUserVersion: UserVersionLookup;
  private metadataCache?: CacheEntry<z.output<typeof authorizationServerMetadataSchema>>;
  private jwksCache?: CacheEntry<JSONWebKeySet>;

  constructor(options: McpJwtTokenVerifierOptions) {
    this.issuerValue = options.issuer;
    this.issuer = validateFetchUrl(options.issuer);
    this.resource = options.resource;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.findUserVersion =
      options.findUserVersion ??
      (async (id) => {
        const { prisma } = await import("@/lib/prisma");
        return prisma.user.findUnique({ where: { id }, select: { id: true, sessionVersion: true } });
      });
  }

  private async fetchJson(url: URL) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/json" },
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
      return await readBoundedJson(response);
    } catch (error) {
      if (error instanceof McpTokenVerifierUnavailableError) throw error;
      throw new McpTokenVerifierUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getMetadata() {
    if (this.metadataCache && this.metadataCache.expiresAt > this.now()) return this.metadataCache.value;
    for (const url of discoveryUrls(this.issuer)) {
      try {
        const metadata = authorizationServerMetadataSchema.parse(await this.fetchJson(url));
        if (metadata.issuer !== this.issuerValue) continue;
        validateFetchUrl(metadata.jwks_uri);
        this.metadataCache = { value: metadata, expiresAt: this.now() + METADATA_TTL_MS };
        return metadata;
      } catch (error) {
        if (!(error instanceof McpTokenVerifierUnavailableError) && !(error instanceof z.ZodError)) throw error;
      }
    }
    throw new McpTokenVerifierUnavailableError();
  }

  private async getJwks(jwksUri: string, forceRefresh = false) {
    if (!forceRefresh && this.jwksCache && this.jwksCache.expiresAt > this.now()) {
      return this.jwksCache.value;
    }
    let parsed: z.output<typeof jwksSchema>;
    try {
      parsed = jwksSchema.parse(await this.fetchJson(validateFetchUrl(jwksUri)));
    } catch (error) {
      if (error instanceof McpTokenVerifierUnavailableError) throw error;
      throw new McpTokenVerifierUnavailableError();
    }
    const jwks = parsed as JSONWebKeySet;
    this.jwksCache = { value: jwks, expiresAt: this.now() + JWKS_TTL_MS };
    return jwks;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const protectedHeader = decodeProtectedHeader(token);
      if (
        protectedHeader.typ !== "at+jwt" ||
        typeof protectedHeader.kid !== "string" ||
        protectedHeader.kid.length === 0 ||
        typeof protectedHeader.alg !== "string" ||
        !ALLOWED_ALGORITHMS.includes(protectedHeader.alg as (typeof ALLOWED_ALGORITHMS)[number])
      ) {
        throw new McpInvalidTokenError();
      }

      const metadata = await this.getMetadata();
      if (!metadata.access_token_signing_alg_values_supported.includes(protectedHeader.alg)) {
        throw new McpInvalidTokenError();
      }

      let jwks = await this.getJwks(metadata.jwks_uri);
      if (!jwks.keys.some((key) => key.kid === protectedHeader.kid)) {
        jwks = await this.getJwks(metadata.jwks_uri, true);
      }
      if (!jwks.keys.some((key) => key.kid === protectedHeader.kid)) throw new McpInvalidTokenError();

      const nowSeconds = Math.floor(this.now() / 1000);
      const verified = await jwtVerify(token, createLocalJWKSet(jwks), {
        algorithms: [...ALLOWED_ALGORITHMS],
        issuer: this.issuerValue,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: new Date(this.now()),
        typ: "at+jwt",
      });
      const claims = verified.payload;
      if (!validAudience(claims.aud, this.resource.href)) throw new McpInvalidTokenError();
      if (
        !Number.isInteger(claims.iat) ||
        !Number.isInteger(claims.exp) ||
        (claims.nbf !== undefined && !Number.isInteger(claims.nbf)) ||
        claims.iat! > nowSeconds + CLOCK_TOLERANCE_SECONDS ||
        claims.exp! - claims.iat! > MAX_TOKEN_LIFETIME_SECONDS ||
        claims.exp! <= claims.iat!
      ) {
        throw new McpInvalidTokenError();
      }
      const scopes = parseScopes(claims.scope);
      const clientId =
        typeof claims.client_id === "string" && claims.client_id
          ? claims.client_id
          : typeof claims.azp === "string" && claims.azp
            ? claims.azp
            : null;
      if (!clientId || typeof claims.sub !== "string" || !claims.sub) throw new McpInvalidTokenError();
      if (!Number.isInteger(claims.stash_session_version)) throw new McpInvalidTokenError();

      const user = await this.findUserVersion(claims.sub);
      if (!user || user.sessionVersion !== claims.stash_session_version) throw new McpInvalidTokenError();

      return {
        token,
        clientId,
        scopes,
        expiresAt: claims.exp,
        resource: this.resource,
        extra: { userId: user.id },
      };
    } catch (error) {
      if (error instanceof McpTokenVerifierUnavailableError) throw error;
      throw new McpInvalidTokenError();
    }
  }
}

let sharedVerifier: McpJwtTokenVerifier | undefined;

export function getMcpTokenVerifier() {
  if (!sharedVerifier) {
    const config = getBookmarkMcpConfiguration();
    sharedVerifier = new McpJwtTokenVerifier({ issuer: config.issuer, resource: config.resource });
  }
  return sharedVerifier;
}

export function resetMcpTokenVerifierForTests() {
  if (process.env.NODE_ENV === "test") sharedVerifier = undefined;
}
