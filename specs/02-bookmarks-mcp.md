# Stash bookmarks MCP specification

Status: ready for implementation
Target: the existing Next.js App Router application
Last reviewed: 2026-08-20

## 1. Objective

Add authenticated bookmark storage and a Model Context Protocol (MCP) endpoint to Stash. The endpoint supports both Stash's existing same-origin Auth.js session and standards-compliant OAuth bearer tokens issued to remote MCP clients.

An authenticated user must be able to:

1. Add a bookmark.
2. List their bookmarks with stable pagination.
3. Search their bookmarks by text and tags.
4. Delete one of their bookmarks.

The MCP server must expose exactly these tools:

- `add_bookmark`
- `list_bookmarks`
- `search_bookmarks`
- `delete_bookmark`

Every bookmark has `id`, `user_id`, `url`, `title`, `tags`, `notes`, and `created_at` in persistent storage. `user_id` is an internal ownership field and must not be accepted in tool input or returned to clients.

This specification is for an implementation agent. Implement the schema change, migration, endpoint, tools, validation, authorization, tests, and documentation described below; do not only scaffold files.

## 2. Existing project constraints

- The repository uses Next.js `16.3.1-canary.25`, React `19.2.8`, TypeScript, Prisma ORM 7, PostgreSQL, Auth.js/NextAuth, Zod 4, pnpm, and the App Router without a `src/` directory.
- Follow the checked-in `AGENTS.md` and consult the matching guides in `node_modules/next/dist/docs/` before implementing Route Handlers. In this version, Route Handlers use Web `Request` and `Response` APIs and are uncached by default.
- Reuse `auth.ts`, `lib/auth-dal.ts`, `lib/prisma.ts`, and the generated Prisma client. Do not introduce a second session format or a second Prisma client.
- `requireApiUser()` already validates the Auth.js cookie, loads the user, and checks `sessionVersion`. The MCP route's cookie-authentication branch must use it before parsing or dispatching an MCP request.
- The bookmark MCP endpoint is an OAuth 2.1 resource server, not an authorization server. A separately operated, trusted authorization server issues audience-bound access tokens and authenticates the same Stash users.
- Section 3 of `specs/01-auth.md` excluded remote MCP authorization from the authentication phase. This specification supersedes that non-goal only for `/api/mcp` and the public protected-resource metadata route; it does not turn Auth.js into an OAuth provider.
- Prisma and MCP tool handlers run in the Node.js runtime and remain server-only.
- Never expose `DATABASE_URL`, `AUTH_SECRET`, session cookies, OAuth access tokens, Prisma errors, request bodies, bookmark notes, or full URLs in logs or error responses.

## 3. Scope and non-goals

### In scope

- The `Bookmark` Prisma model and its relation to `User`.
- A committed `add_bookmarks` migration.
- One stateless MCP Streamable HTTP endpoint at `POST /api/mcp`.
- The four tools and their input/output schemas.
- Auth.js cookie-session authentication for same-origin Stash clients.
- OAuth 2.1 bearer authentication for remote MCP clients, including protected-resource metadata, authorization-server discovery contract, audience validation, scopes, challenges, and local-user mapping.
- Origin/host validation, input normalization, ownership enforcement, stable pagination, structured tool results, observability, and automated tests.

### Not in scope

- A bookmark web UI, Server Actions, or separate REST/GraphQL CRUD endpoints.
- An `update_bookmark` tool, bulk import/export, folders, sharing, collaboration, page-content fetching, link previews, favicon fetching, or dead-link checking.
- MCP resources, prompts, subscriptions, tasks, elicitation, sampling, or server-initiated notifications.
- Implementing or hosting an OAuth authorization server, login/consent UI, token endpoint, refresh-token store, client registration endpoint, or token revocation endpoint inside Stash. These are responsibilities of the configured authorization server.
- Dynamic Client Registration in Stash. Remote clients should use Client ID Metadata Documents or pre-registration with the configured authorization server; DCR is deprecated in MCP `2026-07-28` and is only an optional compatibility feature of the authorization server.
- Semantic/vector search or external search services. Initial search is PostgreSQL-backed case-insensitive substring and exact-tag matching.

## 4. Required MCP approach

### 4.1 Protocol and package

- Use the stable v2 `@modelcontextprotocol/server` package and the MCP protocol revision `2026-07-28`, with the same package's stateless 2025 Streamable HTTP compatibility path for deployed desktop clients. Do not add the legacy monolithic `@modelcontextprotocol/sdk` package or the two-endpoint legacy SSE transport.
- Use `McpServer` and the web-standard `createMcpHandler` entry point. Reuse the repository's Zod 4 dependency for schemas.
- Configure `createMcpHandler` with `legacy: "stateless"` and `responseMode: "json"`. The compatibility leg may encode a POST response as SSE, but this feature needs no connection session, resumability, standalone GET stream, progress messages, or two-endpoint legacy SSE transport.
- Name the server `stash-bookmarks` and use the application version as its server version.
- Register the four tools in the deterministic order shown in section 1. Do not advertise tool-list change notifications because the catalog is static.
- Provide both `outputSchema` and `structuredContent` for successful tool calls. Also include a text content block containing the JSON serialization of the same result for client compatibility.

The current MCP transport sends each message as an HTTP POST to one endpoint, and the current TypeScript SDK builds a fresh server from a per-request factory. See the official [MCP Streamable HTTP specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports) and [TypeScript SDK HTTP serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md).

### 4.2 Remote OAuth architecture

Stash acts only as the OAuth protected resource/resource server. Use the maintained `OAuthTokenVerifier`, `requireBearerAuth`, protected-resource metadata helpers, and `AuthInfo` types exported by `@modelcontextprotocol/server` where they fit the Next.js Web `Request` boundary. Do not import the frozen `@modelcontextprotocol/server-legacy/auth` package.

Required environment configuration:

```dotenv
MCP_AUTH_ISSUER=https://auth.example.com
```

Rules:

- `MCP_AUTH_ISSUER` is the exact trusted authorization-server issuer. It must be an absolute HTTPS URL in production, contain no query or fragment, and be compared exactly to the token `iss` claim. Local test/development issuers may use loopback HTTP.
- Add `MCP_AUTH_ISSUER` to `lib/env.ts` and `.env.example`. Invalid or missing configuration must fail with the variable name but never its value.
- The canonical protected-resource URI is derived from trusted configuration as `${APP_URL}/api/mcp`. It must not contain a fragment and must be used consistently as the RFC 8707 `resource` value, RFC 9728 `resource` metadata value, and access-token audience.
- Fetch authorization-server metadata from the trusted issuer using RFC 8414 or OpenID Connect discovery, require the returned `issuer` to equal `MCP_AUTH_ISSUER`, and obtain `jwks_uri` only from that validated document. Cache successful metadata/JWKS responses with bounded TTLs and support signing-key rotation by `kid`; never derive a fetch URL from a token claim.
- Validate JWT access tokens locally using an established JOSE implementation. Accept only asymmetric algorithms explicitly allowed by both local policy and authorization-server metadata (initially `RS256` and `ES256`); reject `none`, symmetric MAC algorithms, unknown algorithms, and tokens without `kid`.
- Do not add an authorization-server client secret to browser code or the MCP resource server. JWT verification uses public keys.

The configured authorization server must:

- Implement OAuth 2.1 authorization-code flow with PKCE using `S256`, publish RFC 8414 or OpenID Connect discovery metadata, and support Resource Indicators (`resource`) for the exact Stash MCP resource URI.
- Emit and advertise the authorization-response `iss` parameter according to RFC 9207 so conforming remote clients can prevent authorization-server mix-up attacks.
- Authenticate the same human account represented by Stash's local `User` row and issue `sub` as that exact `users.id`. Email-address matching, client-supplied user IDs, and automatic user provisioning are forbidden.
- Issue short-lived RFC 9068-style JWT access tokens with protected-header `typ: at+jwt` and `iss`, `sub`, `aud`, `exp`, `iat`, `scope`, `client_id` (or `azp`), and integer `stash_session_version` claims. The custom version claim must equal the subject user's current `users.session_version` when minted. Access-token lifetime must not exceed 60 minutes.
- Bind the access token audience to the exact canonical resource URI and never issue a token usable at multiple unrelated resources.
- Support the scopes `bookmarks:read` and `bookmarks:write`. It may issue refresh tokens to clients, but refresh tokens are sent only to the authorization server and must never be accepted by Stash's MCP endpoint.
- Prefer Client ID Metadata Documents or pre-registered clients. If the authorization server retains DCR for compatibility, it owns all DCR validation and storage.

Remote client flow:

1. The client calls `/api/mcp` without a token and receives a 401 challenge naming the protected-resource metadata URL and initial `bookmarks:read` scope.
2. The client fetches the RFC 9728 document, selects `MCP_AUTH_ISSUER`, validates its RFC 8414/OpenID discovery metadata, and obtains a client ID through Client ID Metadata Documents, pre-registration, or authorization-server-provided DCR compatibility.
3. The client starts authorization code + PKCE (`S256`), sending the exact canonical `resource` in both authorization and token requests and the least scopes it currently needs. It validates `state`, redirect URI, PKCE, and authorization-response `iss` before exchanging the code.
4. The authorization server authenticates the Stash user, obtains consent, and issues the audience-bound access token. The client stores access/refresh tokens securely and sends only the access token to Stash.
5. The client includes `Authorization: Bearer <access-token>` on every MCP POST. If Stash returns 403 `insufficient_scope`, the client performs bounded step-up authorization for the union of existing and challenged scopes, then retries.

The resource server validates every bearer request before parsing MCP JSON:

1. Parse exactly one `Authorization: Bearer <token>` header. Reject malformed, duplicate, non-Bearer, or empty authorization headers.
2. Require protected-header `typ: at+jwt`; verify signature, allowed algorithm, `kid`, exact `iss`, exact `aud`, `exp`, `nbf` when present, and `iat`. Accept `aud` only as the exact resource string or a single-item array containing it; reject multi-resource audiences. Permit at most 60 seconds of clock skew. Reject tokens whose `exp - iat` exceeds 60 minutes.
3. Parse a space-delimited `scope` string into an exact set. Reject malformed scope claims; never use substring checks.
4. Derive the OAuth client ID from `client_id`, falling back to `azp`. Require a non-empty value for `AuthInfo.clientId`.
5. Load `User` by the validated `sub` value and select only `id` and `sessionVersion`. Require integer `stash_session_version` to equal the current database value. Reject a missing/deleted user or version mismatch with 401 and never create or link a user from token claims. This gives password resets the same immediate access-token revocation boundary as cookie sessions.
6. Build `AuthInfo` with the raw `token`, validated OAuth `clientId`, exact scope array, `expiresAt` from `exp`, the canonical MCP `resource` URL, and `extra.userId` containing the validated local ID. Return an internal principal containing that user ID, auth kind `bearer`, granted scope set, and `AuthInfo`. The raw token may exist only inside `AuthInfo` for the duration of the request and must never be logged, persisted, copied into application data, or returned. Although the SDK exposes `ctx.http.authInfo`, bookmark handlers must not read or copy its `token` field.

Unknown scopes grant no Stash permission. The MCP server must never forward or exchange the inbound bearer token with a downstream API; any future downstream integration obtains a separate audience-bound credential.

The official [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) requires protected-resource discovery, bearer tokens on every request, Resource Indicators, intended-audience validation, and OAuth error challenges.

### 4.3 Protected-resource metadata route

Create a public `GET /.well-known/oauth-protected-resource/api/mcp` Route Handler at `app/.well-known/oauth-protected-resource/api/mcp/route.ts`.

It returns RFC 9728 JSON equivalent to:

```json
{
  "resource": "https://stash.example.com/api/mcp",
  "authorization_servers": ["https://auth.example.com"],
  "scopes_supported": ["bookmarks:read", "bookmarks:write"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Stash bookmarks MCP"
}
```

Requirements:

- Construct values only from validated `APP_URL` and `MCP_AUTH_ISSUER`; do not reflect request headers or query values.
- The route is intentionally unauthenticated, contains no user data or secrets, and supports only `GET`/`HEAD`.
- Return `Content-Type: application/json`, `Access-Control-Allow-Origin: *`, and a short public cache policy such as `public, max-age=300`. The wildcard is limited to this metadata route and must never appear on `/api/mcp`.
- Apply host validation. The route may be fetched without an `Origin` header by remote clients.
- Include this exact metadata URL in every bearer `WWW-Authenticate` challenge as `resource_metadata`.
- Do not serve OAuth authorization-server metadata, JWKS, authorization, token, registration, or revocation endpoints from Stash; clients discover those from `MCP_AUTH_ISSUER`.

### 4.4 MCP route contract

Create `app/api/mcp/route.ts` with:

- `export const runtime = "nodejs"`.
- A `POST` export only. Unsupported methods return `405 Method Not Allowed`; do not add the obsolete HTTP+SSE `GET` endpoint.
- `Content-Type: application/json` for MCP requests. Let the SDK enforce JSON-RPC, MCP protocol metadata, `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` consistency.
- `Cache-Control: no-store` on every MCP, authentication, and guard response. Do not cache responses containing user data.
- `Vary: Authorization, Cookie, Origin` on endpoint responses.
- No permissive CORS headers. Native/desktop/server remote MCP clients call the endpoint directly over HTTPS; cross-origin browser MCP clients are not supported in this phase.

The route processing order is security-sensitive:

1. Validate the request host and, when present, the `Origin` header against the trusted origin parsed from `APP_URL`. Reject a mismatched host or origin with HTTP 403 before MCP dispatch. An absent `Origin` may be accepted only when the host is valid; non-browser clients do not always send `Origin`.
2. Select exactly one credential mode. If an `Authorization` header is present, authenticate only as bearer and never fall back to a valid Auth.js cookie when the bearer token is invalid. If no `Authorization` header is present, call `requireApiUser()` for same-origin session authentication.
3. On missing credentials or failed cookie authentication, return an OAuth-aware HTTP 401 challenge instead of redirecting to `/login`. On invalid bearer authentication, return the SDK bearer-auth 401 challenge. In both cases include the protected-resource metadata URI and initial `bookmarks:read` scope.
4. Only after authentication succeeds may code parse enough of the MCP request to determine its required scope. The final request still goes through the SDK's complete JSON-RPC/schema/header validation. This preserves authentication-before-body-parsing while enabling per-tool least privilege.
5. Require `bookmarks:read` for `server/discover`, `tools/list`, `list_bookmarks`, and `search_bookmarks`. Require `bookmarks:write` for `add_bookmark` and `delete_bookmark`. A write scope does not implicitly grant read; clients performing both kinds of work request both.
6. A missing scope returns HTTP 403 with `WWW-Authenticate: Bearer error="insufficient_scope"`, the complete scope set needed for that operation, and `resource_metadata`. Cookie-authenticated principals receive both scopes internally and do not enter OAuth step-up.
7. Bind the authenticated local `userId`, auth kind, and granted scope set into the per-request server/tool factory. Tool handlers must receive this principal from a server-owned closure, not from arguments or arbitrary request headers. Every tool also asserts its required scope as defense in depth before data access.
8. For a bearer principal, pass the validated `AuthInfo` to `handler.fetch(request, { authInfo })` so MCP HTTP context remains standards-compliant. For a cookie principal, do not manufacture an `AuthInfo`; the cookie is not an OAuth access token.
9. Return the SDK response with `Cache-Control: no-store` and `Vary` preserved.

Use a single internal authentication result such as:

```ts
type McpPrincipal = {
  userId: string;
  authKind: "session" | "bearer";
  scopes: ReadonlySet<"bookmarks:read" | "bookmarks:write">;
  authInfo?: AuthInfo;
};
```

A straightforward route shape is:

```ts
const authentication = await authenticateBookmarkMcpRequest(request);
if (authentication instanceof Response) return authentication;

const handler = createMcpHandler(
  () => createBookmarkMcpServer(authentication.principal),
  { legacy: "stateless", responseMode: "json" },
);

return handler.fetch(request, {
  ...(authentication.principal.authInfo
    ? { authInfo: authentication.principal.authInfo }
    : {}),
});
```

The exact helper names may differ. The route may parse a cloned request or use the SDK's supported pre-parsed-body option after authentication to perform the scope lookup, but it must not consume the only body stream before MCP handling. The authenticated principal must be immutable and server-derived for the lifetime of the request. Keep shared objects such as Prisma and the JWKS cache at module scope; do not keep caller identity in a module global or mutable singleton.

### 4.5 Origin, CSRF, and transport security

- Compare normalized URL origins, not string prefixes. For example, `https://stash.example.com.evil.test` must not match `https://stash.example.com`.
- Use only the configured `APP_URL` origin as the allowlist. Do not trust the inbound `Host`, `Origin`, `Referer`, `X-Forwarded-Host`, or `X-Forwarded-Proto` to create the allowlist.
- If deployment proxy configuration changes the host seen by Next.js, configure the trusted deployment boundary explicitly; do not weaken the application check to accept arbitrary hosts.
- The Auth.js cookie's same-site behavior is defense in depth, not a replacement for origin validation. MCP also requires host/origin validation to mitigate cross-site and DNS-rebinding attacks.
- A remote native client normally sends no `Origin` and is accepted when the host and bearer token are valid. Any request that does send an untrusted `Origin` is rejected, even when it has a valid bearer token.
- Production must use HTTPS. Never place a session token, access token, authorization code, or refresh token in a URL, query parameter, MCP tool argument, log, or tool result.

## 5. Database design

### 5.1 Prisma schema

Extend the existing `User` model and add `Bookmark` as follows:

```prisma
model User {
  id                  String               @id @default(cuid())
  email               String               @unique @db.VarChar(320)
  passwordHash        String               @map("password_hash")
  sessionVersion      Int                  @default(0) @map("session_version")
  createdAt           DateTime             @default(now()) @map("created_at")
  updatedAt           DateTime             @updatedAt @map("updated_at")
  passwordResetTokens PasswordResetToken[]
  bookmarks           Bookmark[]

  @@map("users")
}

model Bookmark {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  url       String   @db.VarChar(2048)
  title     String   @db.VarChar(500)
  tags      String[] @default([])
  notes     String?  @db.Text
  createdAt DateTime @default(now()) @map("created_at")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, url])
  @@index([userId, createdAt(sort: Desc), id(sort: Desc)])
  @@map("bookmarks")
}
```

Schema invariants:

- `user_id` is a required foreign key. Deleting a user cascades to that user's bookmarks.
- The composite unique constraint makes a normalized URL unique within one user's collection, while allowing different users to save the same URL.
- The composite index supports the required per-user newest-first keyset pagination.
- PostgreSQL stores `tags` as a non-null text array. Application validation must always write a normalized, de-duplicated array.
- `notes` is nullable; an omitted or blank note is stored as `null`.
- Do not add `updated_at`: this phase has no update operation and the required bookmark shape contains only `created_at`.
- Do not make `url` globally unique and do not add `user_id` to any public bookmark DTO.
- Do not add OAuth client, authorization-code, access-token, or refresh-token tables. The external authorization server owns those records; Stash validates short-lived access tokens and maps validated `sub` directly to `users.id`.

### 5.2 Migration

- Create and commit a migration named `add_bookmarks`.
- The migration must create the `bookmarks` table, foreign key with `ON DELETE CASCADE`, composite unique constraint, and composite pagination index.
- Run the migration against a development database with `pnpm prisma migrate dev --name add_bookmarks`. If Prisma proposes resetting any non-empty database, stop and obtain explicit approval rather than resetting it.
- Regenerate the existing Prisma client at `app/generated/prisma` and follow the repository's existing generated-code policy.

## 6. Canonical bookmark representation

Tool results use this public JSON shape:

```json
{
  "id": "cm...",
  "url": "https://example.com/article",
  "title": "Example article",
  "tags": ["reference", "typescript"],
  "notes": "Read section 3",
  "created_at": "2026-08-20T12:34:56.789Z"
}
```

Rules:

- Map Prisma's `createdAt` to `created_at` as an ISO 8601 UTC string.
- Return `notes: null` when no note is stored.
- Return tags in their stored normalized order.
- Never return `user_id`, relation objects, email, session metadata, or other user fields.
- Select bookmark columns explicitly. Do not serialize Prisma model/relation objects wholesale.

## 7. Shared input normalization and validation

Validation is authoritative on the server and shared across the MCP tool registrations and data-access layer.

### URL

- Required string, trimmed before parsing, maximum 2,048 characters after canonicalization.
- Parse with the platform `URL` implementation and allow only `http:` and `https:`.
- Reject usernames/passwords in the URL, invalid hosts, control characters, `javascript:`, `data:`, `file:`, and all other schemes.
- Store `URL.href`, which canonicalizes host casing, default ports, and encoding. Preserve the path, query string, and fragment; do not make network requests to the URL.
- Duplicate detection uses the exact canonical stored URL. Do not silently remove tracking parameters or fragments.

### Title

- Required string, trim surrounding whitespace, minimum 1 and maximum 500 Unicode code points.
- Reject a title that becomes empty after trimming.

### Tags

- Optional array; default to `[]`.
- Accept at most 20 tags. Each tag is a string of 1 to 50 Unicode code points after normalization.
- Normalize each tag with Unicode NFKC, trim surrounding whitespace, lowercase it, discard empty entries, and de-duplicate while preserving first occurrence order.
- Apply the maximum tag count after normalization/de-duplication. Reject non-string elements.

### Notes

- Optional nullable string, maximum 10,000 Unicode code points.
- Normalize CRLF/CR newlines to LF and trim surrounding whitespace. Store `null` if the result is empty.
- Do not interpret notes as HTML or Markdown on the server and do not include them in logs.

### IDs, limits, and cursors

- Treat bookmark IDs as opaque strings. Require 1 to 64 characters before querying.
- Page `limit` defaults to 20, has a minimum of 1, and a maximum of 100.
- Cursors are opaque base64url values encoding the last result's `{ created_at, id }`. Decode and validate them strictly; never interpolate cursor values into SQL.
- Invalid cursors produce a safe tool error with code `INVALID_CURSOR`, not a Prisma error or an empty first page.

## 8. Tool contracts

All input schemas must be closed objects: reject unknown properties. In particular, reject `user_id`, `userId`, owner, email, or session fields rather than ignoring them.

The required remote scopes documented below are server-enforced authorization requirements, not tool arguments or ad hoc tool-schema properties.

### 8.1 `add_bookmark`

Purpose: save one bookmark for the authenticated user.

Tool metadata:

- Title: `Add bookmark`
- Description: `Save an HTTP or HTTPS bookmark in the authenticated user's Stash collection. An existing canonical URL is returned unchanged.`
- Required remote scope: `bookmarks:write`

Input:

```json
{
  "url": "https://example.com/article",
  "title": "Example article",
  "tags": ["Reference", "TypeScript"],
  "notes": "Read section 3"
}
```

Required: `url`, `title`. Optional: `tags`, `notes`.

Behavior:

1. Normalize and validate all input.
2. Attempt to create with `userId` taken only from the authenticated principal.
3. If the same user already has the same canonical URL, return the existing bookmark unchanged with `created: false`. Do not overwrite its title, tags, or notes.
4. Handle concurrent duplicates through the composite database unique constraint: catch only that expected constraint violation, fetch the same user's existing row, and return it. Do not use a read-before-write check as the sole duplicate defense.
5. Return the newly created bookmark with `created: true` otherwise.

Output:

```json
{
  "bookmark": { "id": "cm...", "url": "https://example.com/article", "title": "Example article", "tags": ["reference", "typescript"], "notes": "Read section 3", "created_at": "2026-08-20T12:34:56.789Z" },
  "created": true
}
```

Annotations:

```json
{ "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
```

`idempotentHint` is true because exact canonical URL retries return the existing row without modifying it.

### 8.2 `list_bookmarks`

Purpose: list only the authenticated user's bookmarks, newest first.

Tool metadata:

- Title: `List bookmarks`
- Description: `List the authenticated user's bookmarks in newest-first order with cursor pagination.`
- Required remote scope: `bookmarks:read`

Input:

```json
{ "limit": 20, "cursor": null }
```

Both fields are optional. Omit `cursor` or pass `null` for the first page.

Behavior:

- Query with `where: { userId: authenticatedUserId }`.
- Order by `createdAt DESC, id DESC`.
- Use keyset pagination, request `limit + 1` rows, and return a next cursor only when another row exists.
- Do not use offset pagination; concurrent inserts must not cause already-seen bookmarks to shift between pages.

Output:

```json
{
  "bookmarks": [],
  "next_cursor": null
}
```

Annotations:

```json
{ "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
```

### 8.3 `search_bookmarks`

Purpose: search only the authenticated user's bookmark collection.

Tool metadata:

- Title: `Search bookmarks`
- Description: `Search the authenticated user's bookmark titles, URLs, notes, and tags with cursor pagination.`
- Required remote scope: `bookmarks:read`

Input:

```json
{
  "query": "typescript",
  "tags": ["reference"],
  "tag_match": "all",
  "limit": 20,
  "cursor": null
}
```

- `query` is required after trimming, minimum 1 and maximum 200 Unicode code points.
- `tags` is optional and uses the shared tag normalization rules, with at most 10 search tags.
- `tag_match` is optional, one of `"all"` or `"any"`, and defaults to `"all"`.
- `limit` and `cursor` follow `list_bookmarks`.

Behavior:

- Always start with `userId: authenticatedUserId` in the database predicate.
- Match `query` case-insensitively as a substring of `title`, `url`, or non-null `notes`, or as an exact normalized tag.
- If `tags` is present, combine the text-query match with the tag filter using AND. `tag_match: "all"` requires every supplied tag; `"any"` requires at least one.
- Parameterize through Prisma. Do not construct SQL fragments from the query.
- Return results in deterministic `createdAt DESC, id DESC` order with the same keyset cursor contract as listing. This first version does not claim relevance ranking.

Output:

```json
{
  "bookmarks": [],
  "next_cursor": null
}
```

Annotations:

```json
{ "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }
```

### 8.4 `delete_bookmark`

Purpose: delete one bookmark owned by the authenticated user.

Tool metadata:

- Title: `Delete bookmark`
- Description: `Delete a bookmark only when it belongs to the authenticated user.`
- Required remote scope: `bookmarks:write`

Input:

```json
{ "id": "cm..." }
```

Behavior:

- Perform one atomic ownership-scoped mutation equivalent to `deleteMany({ where: { id, userId: authenticatedUserId } })`.
- Never fetch by ID and later delete by ID alone.
- Return `deleted: true` only when exactly one row was deleted.
- Return `deleted: false` when the ID does not exist or belongs to another user. These cases must be indistinguishable to prevent cross-user enumeration.
- A repeated delete is a successful no-op with `deleted: false`.

Output:

```json
{ "id": "cm...", "deleted": true }
```

Annotations:

```json
{ "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true, "openWorldHint": false }
```

Clients should request human confirmation for destructive tool calls. Tool annotations are advisory and do not replace server authorization.

## 9. Authorization and tenant isolation

Authorization must exist at three layers:

1. **Authentication boundary:** validate either the Auth.js session with `requireApiUser()` or the OAuth bearer token plus its mapped local user before MCP parsing or dispatch.
2. **Capability boundary:** require the operation-specific OAuth scope before invoking a bearer-authenticated tool. A cookie session receives both bookmark scopes internally.
3. **Data boundary:** every bookmark read or write contains the authenticated local user ID in the Prisma predicate or create data.

Required rules:

- The tool schema has no user identifier. A caller cannot choose an owner.
- OAuth `client_id` identifies the remote application, not the bookmark owner. Ownership comes only from the token's validated `sub` mapped to an existing local user.
- A valid scope grants an operation over the subject user's collection; it never removes the `userId` database predicate or permits cross-user access.
- If an `Authorization` header is present, invalid bearer credentials fail closed even if the request also carries a valid Auth.js cookie.
- `add_bookmark` assigns the authenticated user ID server-side.
- `list_bookmarks` and `search_bookmarks` always filter by the authenticated user ID, including cursor pages.
- `delete_bookmark` includes both `id` and authenticated user ID in the delete predicate.
- Duplicate lookup after a unique-constraint race includes both authenticated user ID and canonical URL.
- A cursor never grants authority. Even a valid cursor copied from another user cannot remove or weaken the current user's filter.
- Do not rely on a protected page, layout, middleware/proxy redirect, tool description, MCP client confirmation, or obscurity of CUIDs for authorization.
- Prefer DAL functions that require a typed authenticated-principal argument. No exported bookmark query may have an optional owner filter.

## 10. Result and error handling

### HTTP boundary

| Condition | Response |
| --- | --- |
| Invalid host or `Origin` | HTTP 403, generic body |
| No bearer token and no valid Auth.js session | HTTP 401 with `WWW-Authenticate: Bearer resource_metadata="..." scope="bookmarks:read"` |
| Malformed, invalid, expired, wrong-issuer, or wrong-audience bearer token | HTTP 401 with `error="invalid_token"` and `resource_metadata` challenge |
| Valid bearer token missing the operation scope | HTTP 403 with `error="insufficient_scope"`, exact required `scope`, and `resource_metadata` challenge |
| Valid bearer token whose `sub` has no local user or whose `stash_session_version` is stale | HTTP 401 `invalid_token`; do not reveal the internal rejection reason |
| Trusted issuer metadata/JWKS is unavailable and no usable cached key exists | HTTP 503 with a generic retryable error; do not mislabel infrastructure failure as `invalid_token` |
| Unsupported HTTP method | HTTP 405 with `Allow: POST` |
| Unsupported media type | HTTP 415 through the MCP handler |
| Valid cookie- or bearer-authenticated MCP request | MCP/JSON-RPC response |

Authentication, scope, and origin failures occur outside MCP dispatch and must not be encoded as successful tool results. OAuth failures use the SDK's RFC 6750/RFC 9728 response helpers where possible so status codes and challenges remain interoperable.

### MCP and tool errors

- Let the SDK produce protocol-level errors for malformed JSON-RPC, unknown methods/tools, unsupported protocol versions, and input-schema violations.
- Expected tool/domain failures use a tool result with `isError: true` and a concise text content block containing serialized `{ "error": { "code": "...", "message": "..." } }`. Omit `structuredContent` on an error so the result does not violate the tool's success-only `outputSchema`.
- Stable expected codes are `INVALID_CURSOR` and `INTERNAL_ERROR`. Validation handled by the registered input schema should remain an invalid-params protocol error rather than inventing a duplicate tool code.
- Deleting a missing or foreign-owned ID is not an error; return `{ id, deleted: false }`.
- Never return stack traces, Prisma error codes, constraint names, SQL, session details, another user's existence, or raw exception messages.
- Unexpected database errors should be logged in redacted structured form and returned as `INTERNAL_ERROR` with `The bookmark operation could not be completed.`

Every success result must conform to its declared output schema, including `additionalProperties: false` at every object boundary. The bookmark object requires `id`, `url`, `title`, `tags`, `notes`, and `created_at`; add requires `bookmark` and `created`; list/search require `bookmarks` and `next_cursor`; delete requires `id` and `deleted`.

## 11. Suggested file layout

The implementation may adjust names while preserving these boundaries:

```text
app/
  .well-known/
    oauth-protected-resource/
      api/
        mcp/
          route.ts
  api/
    mcp/
      route.ts
lib/
  bookmarks/
    cursor.ts
    dal.ts
    mcp-server.ts
    schemas.ts
  mcp-auth/
    authenticate.ts
    metadata.ts
    token-verifier.ts
prisma/
  migrations/
    ..._add_bookmarks/
      migration.sql
  schema.prisma
tests/
  unit/
    bookmark-schemas.test.ts
    bookmark-cursor.test.ts
    mcp-token-verifier.test.ts
    mcp-protected-resource-metadata.test.ts
  integration/
    bookmarks-dal.test.ts
    bookmarks-mcp.test.ts
```

- Mark bookmark DAL/server modules with `import "server-only"` where appropriate.
- Keep normalization and public DTO mapping in shared server modules so all four tools behave consistently.
- Keep MCP transport concerns out of the DAL. The DAL receives an authenticated principal and validated domain input; it does not parse JSON-RPC or cookies.
- Keep authorization-server discovery, JWKS fetching, JWT validation, challenge generation, and cookie/bearer credential selection in server-only MCP auth modules. No Client Component may import them.

## 12. Privacy, abuse resistance, and observability

- Use structured event names such as `bookmark.add.succeeded`, `bookmark.list.succeeded`, `bookmark.search.succeeded`, `bookmark.delete.succeeded`, and `bookmark.operation.failed`.
- Logs may contain authenticated internal user ID, tool name, duration, result count, created/deleted boolean, and a sanitized failure category.
- Do not log request bodies, `Authorization` headers, access tokens, token signatures, cookies, URLs, titles, tags, notes, search query text, cursor contents, MCP content blocks, or full Prisma exceptions.
- Logs may record auth kind, validated OAuth client ID, configured issuer, required scope, and a coarse rejection category, but must not dump JWT claims or distinguish a missing local subject from other invalid-token failures publicly.
- Discovery and JWKS fetches may contact only URLs obtained from the configured issuer's validated metadata. Apply HTTPS, response-size, content-type, redirect, and timeout limits to prevent SSRF or resource exhaustion; do not follow redirects to an untrusted origin.
- Apply a reasonable request-body limit at the deployment/Route Handler boundary and add an extension point for a shared per-user/IP rate limiter. Input field limits are not a substitute for request-level abuse controls.
- Do not fetch the submitted URL. Merely storing an `http`/`https` URL avoids SSRF in this phase; any future metadata-fetch feature needs a separate SSRF design.
- Use `Cache-Control: no-store`; no bookmark result may enter a public or shared cache.

## 13. Testing requirements

Tests must use an isolated test database and must not reset the developer's regular database. Mock authorization-server discovery/JWKS responses or inject the token verifier; tests must not call a real authorization server or put real tokens in fixtures or log snapshots.

### Unit tests

- URL parsing accepts valid HTTP/HTTPS URLs, canonicalizes them, and rejects unsupported schemes, credentials, invalid hosts, control characters, and values over the limit.
- Title, notes, and tags enforce all boundaries and normalization rules, including NFKC tag normalization and stable de-duplication.
- All tool input schemas reject unknown keys, especially `user_id` and `userId`.
- Cursor encode/decode round-trips and rejects malformed base64, invalid JSON, invalid dates, missing fields, oversized input, and extra fields.
- Public DTO mapping produces snake-case `created_at`, converts dates to UTC ISO strings, preserves `notes: null`, and omits `userId`.
- Output values conform to the registered output schemas.
- Protected-resource metadata contains the exact canonical resource, configured issuer, supported scopes, and header bearer method; it reflects no request values.
- JWT verification accepts a valid token and rejects bad signatures, missing/unknown `kid`, invalid `typ`, disallowed algorithms, wrong/missing issuer, wrong/missing or multi-resource audience, expired/not-yet-valid tokens, excessive lifetime, excessive clock skew, malformed scopes, missing client ID, missing subject, and invalid session-version claim.
- Scope matching uses exact tokens: `bookmarks:read-extra` does not satisfy `bookmarks:read`.
- Authorization-server metadata must echo the configured issuer; JWKS rotation refreshes a missing `kid` once without allowing arbitrary fetch targets.
- OAuth challenge builders emit the required status, `error`, `scope`, and `resource_metadata` fields without exposing verification details.

### Database/integration tests

Use at least two users, Alice and Bob:

- Adding a bookmark stores Alice's server-derived ID regardless of caller-supplied unknown fields, which must be rejected before persistence.
- Alice and Bob can each save the same canonical URL.
- Repeating Alice's add returns one row with `created: false`; a concurrent duplicate race also leaves one row.
- User deletion cascades to bookmarks.
- List returns only the current user's rows in stable newest-first order and obeys limit/cursor boundaries without duplicates.
- Search matches title, URL, notes, and tags as specified; tag `all`/`any` semantics and pagination work.
- Alice cannot list or search Bob's bookmarks, including with a cursor derived from Bob's result.
- Alice cannot delete Bob's bookmark. The result is byte-for-byte equivalent in shape to deleting an unknown ID, and Bob's row remains.
- Repeating a successful delete returns `deleted: false` and does not affect another row.
- Unexpected database failures produce only the generic tool error.
- A bearer token for Alice maps only to Alice's existing `User` row and has the same ownership isolation as Alice's cookie session.
- A valid token whose `sub` is unknown/deleted is rejected and does not auto-provision a user.
- Incrementing Alice's `sessionVersion` immediately rejects an access token carrying her previous `stash_session_version`.

### Route/protocol tests

- An unauthenticated request returns HTTP 401 with the protected-resource challenge, including when its body is malformed JSON, proving auth runs before body parsing.
- A stale session-version cookie returns the same OAuth-aware 401 challenge when no bearer header is present.
- A valid Auth.js cookie can use all four tools.
- A valid bearer token with `bookmarks:read` can discover/list/search but receives a 403 step-up challenge for add/delete.
- A token with both bookmark scopes can use all four tools; a token with only `bookmarks:write` cannot perform read operations.
- An invalid bearer token never falls back to a simultaneously valid cookie.
- Invalid/expired/wrong-audience tokens return 401 `invalid_token`; missing scopes return 403 `insufficient_scope` with the exact required scope.
- Authorization-server metadata/JWKS outage behavior uses bounded caches and returns a generic retryable 503 when verification cannot be completed.
- A mismatched host or origin returns 403 and never calls a tool.
- A remote bearer request with no `Origin` and a valid host succeeds; an untrusted supplied `Origin` is rejected even with a valid token.
- No permissive CORS header is present on `/api/mcp`.
- The protected-resource metadata route is public, has wildcard read-only CORS and short public caching, and returns no user-specific data.
- Authenticated `server/discover`/`tools/list` behavior advertises the tool capability and exactly the four tools in deterministic order.
- Each tool has the expected input schema, output schema, description, and annotations.
- Modern `2026-07-28` requests with valid MCP headers work; stateless 2025 Streamable HTTP initialization also works, while legacy GET/session operations remain unsupported.
- Header/body method or tool-name mismatches and unsupported content types are rejected by the SDK.
- Tool success returns matching `structuredContent` and JSON text content.
- Every `/api/mcp` response has `Cache-Control: no-store`; the separate public metadata route has only the short public cache policy specified in section 4.3.

### Required verification commands

Run and fix all failures from the repository equivalents of:

```bash
pnpm prisma format
pnpm prisma validate
pnpm prisma generate
pnpm lint
pnpm test
pnpm build
```

## 14. Implementation sequence

1. Add the stable MCP v2 server package and an established JOSE verifier with pnpm; confirm compatibility with the repository's Node/TypeScript configuration.
2. Add and validate `MCP_AUTH_ISSUER`, authorization-server discovery, bounded JWKS caching, JWT verification, scope parsing, and OAuth challenge helpers with unit tests.
3. Add the public RFC 9728 protected-resource metadata route and its route tests.
4. Extend the Prisma schema, create the `add_bookmarks` migration, and regenerate the client.
5. Implement shared normalization schemas, cursor handling, and public DTO mapping with unit tests.
6. Implement the ownership-scoped bookmark DAL and two-user integration tests.
7. Register the four tools, output schemas, annotations, structured/text results, and defense-in-depth scope assertions.
8. Add the `/api/mcp` Route Handler with host/origin guards, bearer-or-cookie authentication before parsing, exact per-operation scope checks, caller binding, current plus stateless 2025 Streamable HTTP transport, and no-store responses.
9. Add route/protocol/OAuth tests, update `.env.example` and README with local issuer/client setup, and run the full verification suite.

## 15. Definition of done

The feature is complete only when all of the following are true:

- The `bookmarks` table exists through a committed migration with the specified columns, relation, unique constraint, and index.
- The authenticated MCP endpoint exposes exactly the four required tools using the current stateless MCP transport.
- Authentication happens before MCP body parsing for both credential modes, and every database operation independently scopes itself to the authenticated local user.
- The public protected-resource metadata route advertises the exact MCP resource, trusted authorization server, and bookmark scopes.
- Remote clients can discover the authorization server, obtain an audience-bound token through OAuth 2.1 with PKCE, and call `/api/mcp` using `Authorization: Bearer` on every request.
- Bearer validation fails closed on signature, token type, algorithm, issuer, audience, time, subject, session version, client ID, or scope errors; invalid bearer credentials never downgrade to cookie auth.
- Read and write scopes are enforced with interoperable 401/403 `WWW-Authenticate` challenges and defense-in-depth tool checks.
- No tool accepts or returns `user_id`.
- Cross-user list, search, duplicate lookup, cursor use, and deletion attempts cannot reveal or modify another user's bookmarks.
- Validation, URL/tag normalization, duplicate behavior, pagination, result schemas, annotations, and error contracts match this specification.
- The endpoint rejects invalid origins/hosts, does not enable browser cross-origin access, and never caches user bookmark data; only public protected-resource metadata has wildcard CORS and public caching.
- Logs and public errors contain no session secrets, bearer tokens, JWT claim dumps, or bookmark content.
- Prisma validation/generation, lint, unit tests, integration tests, protocol tests, and the production build pass.
- `.env.example` and README document `MCP_AUTH_ISSUER`, the canonical resource URI, required authorization-server claims/scopes, same-origin cookie use, remote OAuth client setup, token/challenge behavior, and the fact that Stash is a resource server rather than an authorization server.
