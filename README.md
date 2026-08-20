# Stash

Stash is a Next.js App Router application with first-party email/password authentication, stateless Auth.js sessions, Prisma/PostgreSQL persistence, transactional email through Resend, and authenticated bookmark tools over Model Context Protocol (MCP).

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env` and replace every placeholder. Never commit `.env`.
3. Generate `AUTH_SECRET` with `pnpm exec auth secret` (or another cryptographically secure generator).
4. Set `APP_URL` to the trusted public origin, normally `http://localhost:3000` locally. Production must use HTTPS.
5. Configure `EMAIL_FROM` with a sender on a domain verified in Resend.
6. Set `MCP_AUTH_ISSUER` to the exact trusted OAuth authorization-server issuer. Local development may use loopback HTTP; production issuers must use HTTPS and may not contain a query or fragment.
7. Apply migrations with `pnpm prisma migrate dev`. The committed migrations create the authentication and bookmark tables.
8. Create a Vercel AI Gateway key, set `AI_GATEWAY_API_KEY`, and set `AI_MODEL` to a Gateway model that supports tool calls (the example uses `openai/gpt-5.4-mini`).
9. Start the application with `pnpm dev`.

The server validates `DATABASE_URL`, `RESEND_API_KEY`, `AUTH_SECRET`, `APP_URL`, `MCP_AUTH_ISSUER`, `EMAIL_FROM`, `AI_GATEWAY_API_KEY`, and `AI_MODEL` at their first relevant use and reports invalid variable names without printing their values.

## Authentication behavior

- `/signup` creates a credentials user, sends a best-effort welcome email, and signs the user in.
- `/login` creates a seven-day encrypted, HTTP-only Auth.js cookie session.
- `/forgot-password` always returns an account-enumeration-resistant response for valid email syntax.
- `/reset-password` consumes a SHA-256-hashed, 60-minute, single-use token and revokes older sessions by incrementing the user's session version.
- `/` authorizes against the current database record through the DAL before rendering.

`lib/rate-limit.ts` is the extension point for a future shared IP/email limiter. The database-backed 60-second per-account cooldown is not a complete production abuse-control system by itself.

## Bookmarks MCP

The MCP endpoint is stateless Streamable HTTP at `POST /api/mcp`. It serves the current protocol and the SDK's stateless 2025 compatibility handshake for desktop clients; it does not expose the legacy two-endpoint SSE transport. Its canonical RFC 8707 resource identifier and access-token audience are always `${APP_URL}/api/mcp`. Public RFC 9728 discovery is available at `/.well-known/oauth-protected-resource/api/mcp`; Stash does not serve authorization, token, registration, revocation, or JWKS endpoints.

The endpoint exposes exactly four tools:

- `add_bookmark` and `delete_bookmark` require `bookmarks:write`.
- `list_bookmarks` and `search_bookmarks` require `bookmarks:read`.

Same-origin Stash clients may use their Auth.js cookie and receive both capabilities. Remote native, desktop, and server clients send a bearer access token on every request. Browser cross-origin MCP calls are intentionally unsupported. A 401 challenge points clients to the protected-resource document; a 403 `insufficient_scope` challenge identifies the exact scope needed for bounded OAuth step-up.

Stash is only an OAuth 2.1 protected resource. The separately operated authorization server must support authorization code with PKCE `S256`, Resource Indicators for the exact canonical MCP URI, and authorization-response issuer identification. It must publish validated RFC 8414 or OpenID discovery metadata, a `jwks_uri`, and `access_token_signing_alg_values_supported` containing an allowed asymmetric algorithm (`RS256` or `ES256`).

Access tokens must be short-lived JWT access tokens with protected-header `typ: at+jwt` and a `kid`. Required claims are exact `iss`, exact single-resource `aud`, local Stash user ID in `sub`, `exp`, `iat`, space-delimited `scope`, `client_id` (or `azp`), and integer `stash_session_version`. The authorization server must mint that version from the current Stash user row and keep token lifetime at or below 60 minutes. It must never put email addresses in `sub` or expect Stash to provision users from tokens.

For local remote-client testing, configure a loopback authorization server, set `MCP_AUTH_ISSUER` to its issuer, pre-register the client (or use a Client ID Metadata Document), request the exact `${APP_URL}/api/mcp` resource plus the least bookmark scopes, and send only the resulting access token to Stash. Refresh tokens go only to the authorization server.

### Local authorization server for AI clients

Stash includes a development-only loopback authorization server. It signs short-lived access tokens, authenticates against the existing Stash `users` table, binds tokens to the user's current `session_version`, and keeps authorization codes and refresh tokens only in memory. Its signing key and all grants are discarded when the process stops.

1. Use the local values from `.env.example`: `APP_URL=http://localhost:3000`, `MCP_AUTH_ISSUER=http://localhost:4000`, and the identical `LOCAL_AUTH_ISSUER=http://localhost:4000`. Keep the issuer string exactly identical, including any trailing slash.
2. Apply the database migrations and create a Stash account through `/signup` if you do not already have one.
3. In one terminal, run Stash with `pnpm dev`. In a second terminal, run the authorization server with `pnpm dev:auth`.
4. Configure the AI client with the MCP server URL `http://localhost:3000/api/mcp`. A conforming client follows Stash's 401 challenge and discovers the authorization server automatically.
5. At the local consent page, sign in with the same Stash email and password and approve the requested scopes.

Ask for `bookmarks:read` when the client only needs to list or search. Add `bookmarks:write` only when it needs to add or delete. The authorization and token requests must both contain the exact `resource=http://localhost:3000/api/mcp`; the local server rejects missing, altered, or additional resource values.

Public clients can be pre-registered in `.env` as JSON (there is no client secret):

```dotenv
LOCAL_AUTH_CLIENTS_JSON='[{"client_id":"my-ai-client","client_name":"My AI client","redirect_uris":["http://127.0.0.1:8765/oauth/callback"],"token_endpoint_auth_method":"none"}]'
```

The server also accepts an HTTPS (or loopback HTTP) Client ID Metadata Document URL as `client_id`. Pre-registration and metadata documents are the default. For a legacy client that still requires dynamic client registration, set `LOCAL_AUTH_ALLOW_DCR=true` to advertise a local `/register` compatibility endpoint. Restarting the server clears dynamically registered clients, so reconnect or clear that client's cached OAuth registration after a restart.

The token endpoint supports authorization code with PKCE `S256` and rotating refresh tokens. AI clients send access tokens only to `http://localhost:3000/api/mcp`; they send authorization codes and refresh tokens only to `http://localhost:4000/token`. The local server is intentionally bound to `127.0.0.1`, uses ephemeral keys and in-memory grants, and must not be deployed or exposed to a network. For a client running in a VM or container, use a deliberate host bridge and TLS-capable development authorization server instead of changing this server to listen publicly.

## AI chat

The authenticated home page is an ephemeral, streaming chat powered by Vercel AI SDK and AI Gateway. The browser sends AI SDK UI messages to `POST /api/chat`; that server route authenticates the user, opens a request-scoped Streamable HTTP connection to the canonical `${APP_URL}/api/mcp` endpoint, and loads only the four schema-bound bookmark tools.

The assistant can add, list, search, and delete bookmarks. Delete calls use signed AI SDK approval requests and never reach MCP until the user explicitly approves the exact operation. The model is limited to six tool/model steps and the route enforces same-origin checks, a 256 KiB body limit, message/text bounds, safe public errors, no-store responses, and content-free operational logs.

Conversation messages are kept only in browser memory. Refreshing or choosing New chat clears the conversation but does not undo bookmark changes. Stop cancels the active provider request; stream resumption is intentionally disabled. `checkChatRateLimit()` in `lib/rate-limit.ts` is the extension point for a production shared request, concurrency, and token limiter.

Normal automated tests mock the model and MCP client and do not spend Gateway tokens. A manual live smoke test requires a non-production Gateway key and isolated user data: sign in, list bookmarks, add one, request deletion, confirm it remains before approval, then approve or deny the operation.

## Email development

Automated tests mock Resend and never call its API. To preview templates without sending mail, render the exported React components in `emails/` with a local React email preview tool or a private development-only harness. Do not add a public `/api/send` endpoint. For end-to-end email tests, use a separate Resend test key/sender and inbox; never use production recipients.

## Verification

```bash
pnpm prisma format
pnpm prisma validate
pnpm prisma generate
pnpm lint
pnpm test
pnpm build
```

Database integration tests require an isolated `TEST_DATABASE_URL`. Browser tests require isolated test configuration and run with `pnpm test:e2e`. Never point either suite at a developer or production database, and never reset a database without explicit approval.
