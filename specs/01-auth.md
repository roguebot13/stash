# Stash authentication specification

Status: ready for implementation  
Target: the existing Next.js App Router application  
Last reviewed: 2026-08-20

## 1. Objective

Add first-party email-and-password authentication to Stash using NextAuth.js (the `next-auth` package, documented as Auth.js), Prisma, PostgreSQL, and Resend.

The completed feature must let a person:

1. Create an account with an email address and password.
2. Receive a welcome/onboarding email after account creation.
3. Sign in and sign out.
4. Request a password-reset email without revealing whether an account exists.
5. Use a time-limited, single-use link to set a new password.
6. Access the Stash web application only while authenticated.

This specification is for an implementation agent. Implement all behavior, database migrations, tests, and documentation described below; do not only scaffold files.

## 2. Existing project constraints

- The repository currently uses Next.js `16.3.1-canary.25`, React `19.2.8`, TypeScript, the App Router, pnpm, and no `src/` directory.
- Follow the checked-in `AGENTS.md`. In particular, consult the matching guides in `node_modules/next/dist/docs/` before using Next.js APIs. The local authentication guide recommends server-side validation, checks close to the data source, and treating Server Actions like public endpoints.
- `DATABASE_URL` is already present and uses PostgreSQL.
- `RESEND_API_KEY` is already present. Never expose either value to client code, logs, rendered errors, test snapshots, or source control.
- Keep the existing `@/*` path alias.
- Use Server Components by default and Client Components only for interactive form state.
- The only new database tables in this phase are `users` and `password_reset_tokens`. Do not add Auth.js adapter tables such as `accounts`, `sessions`, or `verification_tokens`.

## 3. Scope and explicit non-goals

### In scope

- Registration, credentials sign-in, sign-out, session handling, page protection, forgot-password, reset-password, welcome email, reset email, validation, migrations, automated tests, and setup documentation.
- A minimal authenticated landing state at `/` if the bookmark UI has not yet been implemented. It must be enough to verify the session and sign out.
- Protection helpers that later bookmark and same-origin MCP handlers can reuse.

### Not in scope

- Social login, magic links, email-address verification, MFA, roles, account deletion, changing an email address, and changing a known password from settings.
- Auth.js's Prisma adapter. Credentials users are persisted explicitly by Stash and sessions are stateless, encrypted, and cookie-backed.
- OAuth or bearer-token authorization for third-party remote MCP clients. A browser session can protect Stash's web UI and same-origin handlers, but is not an MCP OAuth implementation.
- A durable distributed rate-limit service. Implement the database-backed cooldown described below and leave a clear extension point for an IP-based production limiter if no shared rate-limit service is available.
- Marketing email or mailing-list enrollment. Both emails in this phase are transactional.

## 4. Required technical approach

### 4.1 Packages

Use current mutually compatible releases, installed with pnpm:

- Runtime: `next-auth`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `resend`, `zod`, `bcrypt`, and `server-only`.
- Development: `prisma`, `dotenv`, `@types/pg`, and `@types/bcrypt`.

Use Prisma ORM 7, the current generally available Prisma release. Do not opt into the early-access "Prisma Next" product. Prisma 7 places the connection URL in `prisma.config.ts` and uses the PostgreSQL driver adapter. Follow the official [Prisma Next.js guide](https://www.prisma.io/docs/guides/frameworks/nextjs).

Do not install `@auth/prisma-adapter`; doing so would conflict with the required two-table design.

### 4.2 Runtime boundaries

- Password hashing, Prisma, token generation, and Resend calls must run only on the server.
- Mark reusable server modules with `import "server-only"`.
- Use the Node.js runtime for handlers/actions that depend on `bcrypt`, Prisma, or Resend. Do not move them to Edge runtime.
- Never import the Prisma client, Resend client, password helpers, or raw environment values into a Client Component.

### 4.3 Auth.js/NextAuth architecture

Use the current Auth.js initialization pattern from the official [Next.js installation guide](https://authjs.dev/getting-started/installation?framework=Next.js):

- Create root `auth.ts` and export `handlers`, `auth`, `signIn`, and `signOut` from `NextAuth(...)`.
- Re-export `GET` and `POST` from `app/api/auth/[...nextauth]/route.ts`.
- Configure the Credentials provider with `email` and `password` fields.
- Use Auth.js's stateless cookie-backed session mode. Set `session.strategy` explicitly to `"jwt"` because that is Auth.js's configuration name for an encrypted JWE stored in the session cookie; there is no database session table and the token must never be stored in `localStorage`.
- Set the session lifetime explicitly to seven days. Use Auth.js's production cookie defaults: HTTP-only, secure on HTTPS, same-site, and scoped to `/`. Do not implement a second custom session cookie.
- Configure a custom sign-in page at `/login`.
- Use `AUTH_SECRET`; never hard-code a secret.
- Keep the encrypted cookie payload minimal: user ID and session version. Do not put the password hash, email address, or reset data in it.
- In the `session` callback, expose `session.user.id` and `session.user.sessionVersion` for server-side ownership/revocation checks, and augment Auth.js's TypeScript types accordingly. The version is not a secret but is internal authorization metadata and must not be rendered.
- Validate Credentials input with Zod inside `authorize`, normalize the email, fetch the user by normalized email, and use `bcrypt.compare`. For an unknown email, compare against one precomputed valid dummy bcrypt hash so it does not take an obvious fast path. Return `null` for every bad email/password combination so the UI always shows the same message.
- The `authorize` callback must never create users. Registration is a separate explicit flow.

Auth.js documents the Credentials provider and server-side validation in its [Credentials guide](https://authjs.dev/getting-started/authentication/credentials). Its cookie-backed strategy is configured as `"jwt"` and stores an encrypted JWE in an HTTP-only cookie; set the strategy explicitly so adding any future adapter cannot silently change it to database sessions.

## 5. Environment configuration

The implementation must validate required server environment variables at startup or first server use and fail with a clear variable name but never its value.

Required:

```dotenv
DATABASE_URL=postgres://...
RESEND_API_KEY=re_...
AUTH_SECRET=...
APP_URL=http://localhost:3000
EMAIL_FROM=Stash <onboarding@your-verified-domain.example>
```

Rules:

- `APP_URL` is the trusted absolute origin used to build password-reset links. Strip a trailing slash during parsing. Do not build security-sensitive links from the request `Host` header.
- `EMAIL_FROM` must use a domain verified in Resend in production. Resend's [Next.js guide](https://resend.com/docs/send-with-nextjs) requires an API key and verified domain. Resend permits any sender address under a verified domain and supports a friendly name in the `from` value, as described in its [sender-address documentation](https://resend.com/docs/knowledge-base/how-do-I-create-an-email-address-or-sender-in-resend).
- `AUTH_SECRET` should be generated with `npx auth secret` or an equivalent cryptographically secure generator.
- Only variables intentionally needed by browser code may use `NEXT_PUBLIC_`; none of the five variables above may use it.
- Update `.env.example` with placeholder values and README setup instructions. Do not modify or commit real `.env` values.

## 6. Database design

Create `prisma/schema.prisma`, `prisma.config.ts`, a generated-client output location, and `lib/prisma.ts` following Prisma 7 conventions. Reuse one Prisma client during development hot reload and initialize it with `PrismaPg` using `DATABASE_URL`.

The Prisma schema must be semantically equivalent to:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../app/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model User {
  id                  String               @id @default(cuid())
  email               String               @unique @db.VarChar(320)
  passwordHash        String               @map("password_hash")
  sessionVersion      Int                  @default(0) @map("session_version")
  createdAt           DateTime             @default(now()) @map("created_at")
  updatedAt           DateTime             @updatedAt @map("updated_at")
  passwordResetTokens PasswordResetToken[]

  @@map("users")
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  tokenHash String    @unique @map("token_hash") @db.Char(64)
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")
  userId    String    @map("user_id")
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt])
  @@map("password_reset_tokens")
}
```

Schema invariants:

- Persist only normalized lowercase email addresses: `trim().toLowerCase()`.
- The unique email constraint is the final defense against concurrent duplicate registration. Catch Prisma's unique-constraint error and map it to the generic registration response.
- `passwordHash` stores a complete bcrypt hash, including cost and salt. Never add a plaintext password or separate salt column.
- `tokenHash` stores a lowercase SHA-256 hex digest of the raw reset token. Raw reset tokens must never be stored.
- `usedAt` provides an audit-friendly single-use marker; do not rely only on deleting a row.
- `sessionVersion` starts at zero and is incremented on a password reset to invalidate pre-reset sessions at the authorization layer.
- Create and commit an initial migration. Use `prisma migrate dev --name init_auth` against a development database. If Prisma proposes resetting a non-empty database, stop and obtain explicit user approval rather than resetting it.
- Add a `postinstall` or equivalent build step that runs `prisma generate` if required by the deployment environment. Generated client output should follow the repository's chosen source-control policy consistently.

## 7. Password and token security

### 7.1 Password policy

- Minimum 12 characters and maximum 72 bytes after UTF-8 encoding. Return a validation error when the UTF-8 byte length exceeds 72; a character-count-only limit is insufficient for Unicode input.
- Accept Unicode, spaces, and pasted values. Do not trim or silently transform passwords.
- Do not require arbitrary uppercase/lowercase/number/symbol composition rules.
- Confirm password on registration and reset; compare confirmation server-side as well as in the browser.
- Never log form bodies or password values.

Use bcrypt 6 or later with a cost factor of 12, centralized in one password helper so it can be tuned after measuring production hardware. Hash with `await bcrypt.hash(password, 12)` and verify with `await bcrypt.compare(...)`; use only the asynchronous APIs so CPU-intensive work does not block the Node.js event loop, and do not manually generate or store salts. Bcrypt only processes 72 bytes, so enforce the UTF-8 byte limit before hashing and comparison. The [bcrypt project documentation](https://github.com/kelektiv/node.bcrypt.js/) documents its async API and 72-byte behavior, while the [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) requires a work factor of at least 10 when bcrypt is used.

### 7.2 Reset token policy

- Generate 32 random bytes with Node's `crypto.randomBytes(32)` and encode with base64url.
- Hash the raw token with SHA-256 before database lookup/storage.
- Expire tokens 60 minutes after creation.
- Tokens are single-use. A successful reset marks every still-unused token for that user as used in the same transaction.
- The reset page must use `Referrer-Policy: no-referrer` so the query token is not leaked in referrers. After extracting the token, avoid loading third-party assets or analytics on the reset page.
- Do not put email, user ID, or other user data in the reset URL.
- Never log the raw token or full reset URL.

These controls follow the [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), which requires cryptographically random, securely stored, expiring, single-use tokens and account-enumeration-resistant responses.

## 8. User flows and behavior

### 8.1 Registration

Route: `/signup`  
Fields: `email`, `password`, `confirmPassword`

Server behavior:

1. Validate and normalize the email; validate both password fields.
2. Hash the password before persistence.
3. Create the user through Prisma, relying on the unique constraint for races.
4. Send the welcome email using the created user ID as the Resend idempotency entity.
5. Sign the user in using Auth.js Credentials and redirect to `/`.

Failure behavior:

- Invalid fields return field-level errors.
- Existing email and unique-race cases return: `Unable to create an account with those details. Try signing in or resetting your password.` Do not state that the account exists.
- A Resend failure must not roll back or disable a valid new account. Log a structured server-side error without secrets, continue sign-in, and make the welcome email best-effort.
- A database or hashing failure returns a generic retryable error and creates no partial account.

Authenticated users visiting `/signup`, `/login`, or `/forgot-password` should be redirected to `/`.

### 8.2 Sign in

Route: `/login`  
Fields: `email`, `password`

- Submit through a Server Action that calls `signIn("credentials", ...)`.
- On success redirect to a validated internal `returnTo` path or `/`. Accept only paths beginning with exactly one `/`; reject protocol-relative paths (`//...`) and absolute URLs.
- For invalid input, unknown email, or wrong password, display only: `Invalid email or password.`
- Preserve the email value after a failed attempt, never the password.
- Include links to `/signup` and `/forgot-password`.
- Handle Auth.js redirect/control-flow errors correctly; do not convert a successful redirect into a generic failure.

### 8.3 Sign out

- Provide a POST-backed sign-out form/button that calls Auth.js `signOut({ redirectTo: "/login" })` on the server.
- Do not use a state-changing GET endpoint.

### 8.4 Forgot password

Route: `/forgot-password`  
Field: `email`

Always return the same success state and status after syntactically valid input:

`If an account exists for that email, we sent a password reset link.`

For an existing user:

1. Normalize and find the email.
2. If that user's newest unused, unexpired token was created less than 60 seconds ago, do not create or send another token; still return the generic success state. This is the database-backed per-account cooldown.
3. Otherwise generate the raw token, store only its SHA-256 hash with a 60-minute expiry, and send the reset email.
4. Use a Resend idempotency key based on the reset-token row ID.
5. If sending fails, log a redacted structured error and mark the just-created token used (or delete that row) so a later request is not blocked by an undelivered token.

For an unknown email:

- Do no database write and send no email.
- Compare against one precomputed valid dummy bcrypt hash (do not generate a fresh hash per request) so the route does not have an obvious fast path.
- Return exactly the same public result as the existing-user path.

Add an abstraction point for a future shared IP/email rate limiter. Do not claim the 60-second database cooldown is sufficient for a multi-instance production deployment.

### 8.5 Reset password

Route: `/reset-password?token=<raw-token>`  
Fields: `password`, `confirmPassword`; the token must be carried in a hidden form value or bound server-action argument and never rendered in logs.

Page behavior:

- Missing or malformed token shows `This reset link is invalid or has expired.` and a link back to `/forgot-password`.
- Do not reveal the associated email address.
- Set page metadata/referrer policy to `no-referrer`.

Submission behavior:

1. Validate token shape and passwords before expensive work.
2. Compute the SHA-256 token hash and prepare the new bcrypt password hash.
3. In one Prisma transaction, atomically claim the matching token only if `usedAt` is null and `expiresAt` is later than the transaction time.
4. If the claim count is not exactly one, return the generic invalid/expired message and change nothing.
5. Update the user's `passwordHash`, increment `sessionVersion`, and set `usedAt` on all remaining unused reset tokens for that user.
6. On success redirect to `/login?reset=success` and show `Your password has been reset. Sign in with your new password.`

The atomic conditional claim is required so two concurrent submissions cannot both succeed.

### 8.6 Session protection and revocation

- `/`, future bookmark pages, and every user-data mutation are authenticated.
- Auth pages and Auth.js endpoints remain public.
- A server-side `requireUser()`/DAL helper must call `auth()`, require `session.user.id`, fetch the current user, compare the cookie session version with `users.session_version`, and return only safe user fields (`id`, `email`). Redirect pages to `/login`; return a 401/403 as appropriate from API/MCP handlers.
- Every Server Action and Route Handler that reads or mutates user data must call this helper near the database operation. A layout or Proxy redirect is not sufficient authorization.
- If using `proxy.ts`, use the Next.js 16 filename and keep it to optimistic redirect checks. Exclude static assets and Auth.js endpoints, avoid database queries there, and keep secure checks in the DAL.
- On successful password reset, old encrypted session cookies may remain in browsers, but `sessionVersion` mismatch must prevent them from authorizing data access. A fresh sign-in receives the new version.
- Bookmark queries added later must always filter by the authenticated user ID and never trust a user ID supplied by the client.

## 9. Email implementation

Follow Resend's official [Next.js SDK guide](https://resend.com/docs/send-with-nextjs) and [send-email API reference](https://resend.com/docs/api-reference/emails/send-email): initialize `new Resend(process.env.RESEND_API_KEY)`, send with `resend.emails.send`, supply the configured `from`, recipient, subject, and a React email component via the `react` field, and handle both returned `error` values and thrown exceptions.

Create server-only send helpers and two reusable React templates:

### 9.1 Welcome/onboarding email

- Suggested file: `emails/welcome-email.tsx`
- Subject: `Welcome to Stash`
- Content: welcome the user, briefly explain that Stash saves and manages bookmarks, and link to `${APP_URL}/` with CTA text `Open Stash`.
- Do not include the password or any authentication token.
- Idempotency key: `welcome-user/<user-id>`.

### 9.2 Password-reset email

- Suggested file: `emails/password-reset-email.tsx`
- Subject: `Reset your Stash password`
- Link: `${APP_URL}/reset-password?token=${encodeURIComponent(rawToken)}`.
- State that the link expires in 60 minutes and can be used once.
- State that the recipient can ignore the message if they did not request it.
- CTA text: `Reset password`.
- Idempotency key: `password-reset/<password-reset-token-row-id>`.

### 9.3 Shared email requirements

- Include a concise preheader, semantic headings, a visible full fallback URL for clients where the button fails, and plain-text content (explicitly or through a verified SDK rendering path).
- Use email-safe inline styles and no remote JavaScript.
- Escape all dynamic content through React; never use untrusted raw HTML.
- Ensure links use the trusted HTTPS `APP_URL` in production.
- Treat `{ data, error }` correctly: a resolved SDK promise with `error` is a failure.
- Pass the idempotency key through the SDK's second options argument. Resend retains keys for 24 hours and recommends event/entity-shaped values in its [idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).
- Log email kind, internal entity ID, Resend email ID on success, and a sanitized error code/message on failure. Do not log email body, raw reset token, or reset URL.

## 10. Validation, actions, and UI contract

Use shared Zod schemas for registration, sign-in, forgot-password, and reset-password. Client HTML constraints improve UX, but server validation is authoritative.

Use React 19 `useActionState` for form results and pending states. Each form must:

- Have associated labels, appropriate `type`, `name`, and `autoComplete` values (`email`, `current-password`, or `new-password`).
- Set `aria-invalid` and connect errors with `aria-describedby`.
- Render status/error text in an `aria-live="polite"` region.
- Disable only its submit button while pending and show an explicit pending label.
- Prevent double submission through pending state; correctness must still hold under concurrent requests.
- Avoid clearing a user's non-secret input after validation errors.
- Work without client-side JavaScript through Server Action progressive enhancement where practical.

Suggested public routes:

| URL | Purpose | Anonymous | Authenticated |
| --- | --- | --- | --- |
| `/login` | Credentials sign-in | Form | Redirect to `/` |
| `/signup` | Registration | Form | Redirect to `/` |
| `/forgot-password` | Request reset | Form | Redirect to `/` |
| `/reset-password` | Consume token | Form or invalid state | Form or invalid state |
| `/api/auth/[...nextauth]` | Auth.js protocol endpoints | Allowed | Allowed |
| `/` | Stash application | Redirect to `/login` | Allowed |

Use a route group such as `app/(auth)/...` if useful; route-group names must not appear in URLs.

## 11. Suggested file layout

The implementation may adjust names while preserving separation of concerns:

```text
app/
  (auth)/
    login/page.tsx
    signup/page.tsx
    forgot-password/page.tsx
    reset-password/page.tsx
  api/auth/[...nextauth]/route.ts
  generated/prisma/...
  page.tsx
auth.ts
emails/
  welcome-email.tsx
  password-reset-email.tsx
lib/
  auth-actions.ts
  auth-dal.ts
  auth-schemas.ts
  env.ts
  mail.ts
  password.ts
  prisma.ts
  reset-token.ts
prisma/
  migrations/...
  schema.prisma
prisma.config.ts
types/
  next-auth.d.ts
```

Do not create a public unauthenticated `app/api/send` test endpoint from the Resend quickstart. Email helpers must be called only from the registration and forgot-password server flows.

## 12. Error handling, privacy, and observability

- Authentication and recovery errors shown to users must not contain stack traces, Prisma errors, Auth.js error codes, Resend responses, or environment details.
- Use generic messages for login, registration duplicates, and forgot-password to reduce account enumeration. This follows the [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
- Log authentication events in structured form: registration success/failure category, sign-in success/failure, reset request accepted, email success/failure, reset success, and reset-token rejection category. Do not log secrets or distinguish unknown accounts in externally visible telemetry.
- Never serialize Prisma `User` objects wholesale into Client Components because they contain `passwordHash`.
- Select safe fields explicitly in all queries that can reach UI/session code.
- Add `Cache-Control: no-store` to auth/recovery responses where a Route Handler is used. Auth and reset pages must not be statically cached with user-specific state.
- Production must use HTTPS. Rely on Auth.js's secure, HTTP-only, same-site cookie defaults; do not weaken cookie options to make production debugging easier.

## 13. Testing requirements

Tests must not call the real Resend API. Mock the Resend client at the mail-helper boundary.

### Unit tests

- Email normalization and all Zod validation boundaries.
- Password hash/verify succeeds for the right password and fails for the wrong one; hashes differ for the same password because of salts.
- Reset tokens have adequate entropy/shape and only the deterministic SHA-256 hash is used for lookups.
- `returnTo` accepts local paths and rejects absolute/protocol-relative paths.
- Email helpers send the correct recipient, subject, React content, sender, and idempotency key, and treat both returned and thrown errors as failures.

### Database/integration tests

- Registration stores normalized email and a bcrypt hash, never plaintext.
- Concurrent/duplicate registration does not create two users and returns the intended generic result.
- Credentials sign-in works only with the correct password.
- Forgot-password returns the same public result for known and unknown emails.
- The 60-second cooldown prevents repeated token/email creation.
- The database contains only a token hash, not the raw token.
- A valid reset updates the password, marks all reset tokens used, increments `sessionVersion`, and permits login only with the new password.
- Expired, already-used, malformed, missing, and concurrent-use tokens cannot reset a password.
- A session issued before reset is rejected by the DAL after `sessionVersion` changes.
- Resend failure during registration does not delete the user; Resend failure during reset request does not leave an active cooldown token.
- Cascading user deletion removes reset-token rows.

### Browser/end-to-end tests

- Anonymous access to `/` redirects to `/login`.
- A user can sign up, reaches `/`, sees authenticated UI, signs out, and can sign back in.
- Validation and generic errors are visible and accessible.
- Forgot-password always displays the generic confirmation.
- A captured test reset link can reset the password once and then shows invalid/expired state.
- An authenticated user is redirected away from login/signup/forgot-password pages.

### Required verification commands

Run and fix all failures from the repository's equivalents of:

```bash
pnpm prisma format
pnpm prisma validate
pnpm prisma generate
pnpm lint
pnpm test
pnpm build
```

Run migration-based integration tests against an isolated test database, not the developer's regular database. Never reset a database without explicit approval.

## 14. Implementation sequence

1. Install dependencies and add environment validation/example documentation.
2. Add Prisma 7 configuration, schema, generated client setup, and the `init_auth` migration.
3. Implement email normalization, Zod schemas, bcrypt helpers, reset-token helpers, and their unit tests.
4. Configure Auth.js Credentials/cookie-backed session handling, session typing, route handler, and DAL/session-version checks.
5. Implement registration and login actions/forms, then authenticated landing/sign-out.
6. Implement Resend client wrapper and both templates according to official Resend docs.
7. Implement forgot-password and atomic reset flows.
8. Add route protection and ensure all mutations re-check authorization at the data layer.
9. Add integration and browser tests, update README, and run the complete verification suite.

## 15. Definition of done

The feature is complete only when all of the following are true:

- All required user flows in section 1 work end to end.
- `users` and `password_reset_tokens` exist through a committed Prisma migration and no Auth.js adapter tables were added.
- No plaintext password or raw reset token is stored or logged.
- Welcome and reset emails use the official Resend Node SDK with React content, the configured sender, and idempotency keys.
- Forgot-password and login responses do not disclose account existence.
- Reset tokens expire, are single-use under concurrency, and old sessions lose data access after a reset.
- Protected pages/actions/handlers authorize near the data access, not only in UI or Proxy.
- Environment documentation contains placeholders only.
- Unit, integration, end-to-end, lint, Prisma validation, and production build checks pass.
- README explains local migration, `AUTH_SECRET`, `APP_URL`, Resend verified-domain setup, and how to preview/test emails without sending real mail.
