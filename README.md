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
8. Start the application with `pnpm dev`.

The server validates `DATABASE_URL`, `RESEND_API_KEY`, `AUTH_SECRET`, `APP_URL`, `MCP_AUTH_ISSUER`, and `EMAIL_FROM` and reports invalid variable names without printing their values.

## Authentication behavior

- `/signup` creates a credentials user, sends a best-effort welcome email, and signs the user in.
- `/login` creates a seven-day encrypted, HTTP-only Auth.js cookie session.
- `/forgot-password` always returns an account-enumeration-resistant response for valid email syntax.
- `/reset-password` consumes a SHA-256-hashed, 60-minute, single-use token and revokes older sessions by incrementing the user's session version.
- `/` authorizes against the current database record through the DAL before rendering.

`lib/rate-limit.ts` is the extension point for a future shared IP/email limiter. The database-backed 60-second per-account cooldown is not a complete production abuse-control system by itself.

## Bookmarks MCP

The stateless, modern-only MCP endpoint is `POST /api/mcp`. Its canonical RFC 8707 resource identifier and access-token audience are always `${APP_URL}/api/mcp`. Public RFC 9728 discovery is available at `/.well-known/oauth-protected-resource/api/mcp`; Stash does not serve authorization, token, registration, revocation, or JWKS endpoints.

The endpoint exposes exactly four tools:

- `add_bookmark` and `delete_bookmark` require `bookmarks:write`.
- `list_bookmarks` and `search_bookmarks` require `bookmarks:read`.

Same-origin Stash clients may use their Auth.js cookie and receive both capabilities. Remote native, desktop, and server clients send a bearer access token on every request. Browser cross-origin MCP calls are intentionally unsupported. A 401 challenge points clients to the protected-resource document; a 403 `insufficient_scope` challenge identifies the exact scope needed for bounded OAuth step-up.

Stash is only an OAuth 2.1 protected resource. The separately operated authorization server must support authorization code with PKCE `S256`, Resource Indicators for the exact canonical MCP URI, and authorization-response issuer identification. It must publish validated RFC 8414 or OpenID discovery metadata, a `jwks_uri`, and `access_token_signing_alg_values_supported` containing an allowed asymmetric algorithm (`RS256` or `ES256`).

Access tokens must be short-lived JWT access tokens with protected-header `typ: at+jwt` and a `kid`. Required claims are exact `iss`, exact single-resource `aud`, local Stash user ID in `sub`, `exp`, `iat`, space-delimited `scope`, `client_id` (or `azp`), and integer `stash_session_version`. The authorization server must mint that version from the current Stash user row and keep token lifetime at or below 60 minutes. It must never put email addresses in `sub` or expect Stash to provision users from tokens.

For local remote-client testing, configure a loopback authorization server, set `MCP_AUTH_ISSUER` to its issuer, pre-register the client (or use a Client ID Metadata Document), request the exact `${APP_URL}/api/mcp` resource plus the least bookmark scopes, and send only the resulting access token to Stash. Refresh tokens go only to the authorization server.

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
