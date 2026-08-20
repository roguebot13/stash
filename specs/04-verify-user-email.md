# Stash email-verification specification

Status: ready for implementation  
Target: the existing Next.js App Router application  
Last reviewed: 2026-08-20

## 1. Objective

Require a new user to prove control of their email address before their Stash account becomes active.

The completed feature must let a person:

1. Submit the existing email-and-password registration form and create a pending account.
2. Receive a time-limited email-verification link.
3. Explicitly confirm the link and activate the account exactly once.
4. Sign in only after activation.
5. Request a replacement verification email without revealing whether a pending account exists.

An account is **pending** while `users.email_verified_at` is `NULL` and **active** after it contains the first successful verification timestamp. Creating a database row is not activation. Password possession, password reset, an Auth.js cookie, and a remote MCP bearer token must not bypass this invariant.

This specification is for an implementation agent. Implement all behavior, migration, tests, email content, and documentation described below; do not only scaffold files.

### 1.1 Relationship to earlier specifications

This is an additive amendment to `specs/01-auth.md` and the authentication assumptions reused by `specs/02-bookmarks-mcp.md` and `specs/03-chat-interface.md`. Where requirements conflict, this specification takes precedence. In particular, it supersedes email verification being a non-goal, immediate sign-in after registration, welcome email at account creation, the original two-auth-table limit, and existing tests that expect a new user to reach `/` immediately. Password policy, session strategy, reset-token security, bookmark ownership, MCP protocol behavior, and chat behavior remain unchanged except for the active-account checks explicitly required here.

## 2. Existing project context

- The repository uses Next.js `16.3.1-canary.25`, React `19.2.8`, TypeScript, Prisma ORM 7, PostgreSQL, Auth.js/NextAuth `5.0.0-beta.32`, Resend, Zod 4, Vitest, and Playwright.
- The App Router is used without a `src/` directory. Authentication is implemented in root `auth.ts`, `lib/auth-actions.ts`, `lib/auth-service.ts`, `lib/auth-dal.ts`, and `app/(auth)/**`.
- The current signup flow creates a `User`, sends a welcome email on a best-effort basis, signs the user in immediately, and redirects to `/`. This behavior must change: signup creates a pending user, sends a verification email, creates no session, and sends no welcome email yet.
- The current Credentials provider authorizes any user with the correct password. It must also require a non-null verification timestamp.
- The current DAL protects web data with the Auth.js user ID and `sessionVersion`. The MCP bearer-token verifier separately maps remote subjects to local users. Both paths must enforce the active-account invariant as defense in depth.
- Password-reset tokens already use 256-bit random values, SHA-256 storage, expiry, single-use claims, per-account cooldowns, and transaction-safe consumption. Reuse the security pattern, but do not reuse password-reset rows or accept one token type in the other flow.
- `APP_URL`, `EMAIL_FROM`, and `RESEND_API_KEY` are already validated server-side. Use the trusted `APP_URL` to create verification links; never derive them from a request `Host` header.
- Follow `AGENTS.md` and the matching local guides in `node_modules/next/dist/docs/`. In this Next.js version, Server Actions are public endpoints, `redirect()` throws and belongs outside a caught `try` block, and authorization must be checked close to protected data access.

## 3. Scope and non-goals

### In scope

- Pending-versus-active account state.
- A Prisma schema change and committed forward migration.
- Secure verification-token generation, storage, expiry, replacement, and atomic consumption.
- Verification and resend emails through the existing Resend wrapper.
- Signup, login, verification, resend, welcome-email, password-recovery, web-session, and MCP authorization changes.
- Accessible pending, verification, success, invalid-link, and resend UI states.
- Structured, secret-free observability.
- Unit, integration, and browser tests plus README updates.

### Not in scope

- Changing a verified email address.
- Verifying an email through the password-reset flow.
- Magic-link sign-in, social login, MFA, roles, invitations, or administrator approval.
- Automatically deleting dormant pending accounts or historical token rows. A later retention job may remove old rows.
- A distributed IP/email abuse-prevention service. Preserve the existing extension point and implement the database-backed per-account cooldown below.
- Deliverability analytics, marketing consent, or mailing-list enrollment.

## 4. Required invariants

The implementation is acceptable only if all of these remain true under retries and concurrent requests:

1. Every user created after the migration starts pending with `emailVerifiedAt = null`.
2. Every user that existed before the migration remains active after deployment.
3. Only successful consumption of a valid email-verification token may set `emailVerifiedAt` for a pending account.
4. `emailVerifiedAt` records the first successful activation time and is never overwritten by later requests.
5. Pending users cannot obtain a Credentials session, authorize through the web DAL, use the same-origin MCP endpoint, or map a remote MCP bearer token to a usable local account.
6. No raw verification token is stored, logged, placed in an idempotency key, or returned from a Server Action.
7. A token is purpose-specific, expires, can be consumed once, and cannot successfully activate two accounts or activate one account twice.
8. Issuing a replacement invalidates every older unused verification token for that user.
9. Password reset never sets `emailVerifiedAt` and does not issue reset mail for a pending account.
10. Email-delivery failure never activates an account. It also must not leave an undelivered token blocking an immediate resend.

## 5. Database design and migration

### 5.1 Prisma schema

Extend `User` and add a purpose-specific token model semantically equivalent to:

```prisma
model User {
  id                      String                   @id @default(cuid())
  email                   String                   @unique @db.VarChar(320)
  passwordHash            String                   @map("password_hash")
  emailVerifiedAt         DateTime?                @map("email_verified_at")
  sessionVersion          Int                      @default(0) @map("session_version")
  createdAt               DateTime                 @default(now()) @map("created_at")
  updatedAt               DateTime                 @updatedAt @map("updated_at")
  emailVerificationTokens EmailVerificationToken[]
  passwordResetTokens     PasswordResetToken[]
  bookmarks               Bookmark[]

  @@map("users")
}

model EmailVerificationToken {
  id        String    @id @default(cuid())
  tokenHash String    @unique @map("token_hash") @db.Char(64)
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")
  userId    String    @map("user_id")
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt])
  @@map("email_verification_tokens")
}
```

Do not use Auth.js adapter `VerificationToken` semantics and do not add adapter tables. Stash owns this credentials-account activation flow explicitly.

### 5.2 Forward-only rollout

Create a new migration after `20260820130000_add_bookmarks`; do not edit either committed migration.

The migration must perform these operations in this order:

1. Add nullable `users.email_verified_at` with no database default.
2. Backfill every existing user with the migration transaction timestamp so no current account is locked out.
3. Create `email_verification_tokens`, its primary key, unique token-hash index, `(user_id, expires_at)` index, and cascading foreign key.

The application model remains nullable after the backfill because null is the intentional pending state for all future inserts. Do not add `DEFAULT CURRENT_TIMESTAMP`; it would silently activate new users. Document the existing-user backfill in the migration SQL and README deployment notes.

The schema/application deployment must be compatible with the normal `prisma migrate deploy` startup sequence. Never reset a non-empty database to apply this change.

## 6. Token policy

Create `lib/email-verification-token.ts` or a clearly named equivalent. It must be server-only where appropriate and expose narrowly scoped helpers/constants.

- Generate 32 bytes with Node `crypto.randomBytes(32)` and encode with `base64url`.
- Accept only the canonical 43-character shape `^[A-Za-z0-9_-]{43}$` before hashing or querying.
- Store and query only the lowercase SHA-256 hexadecimal digest of the raw token.
- Expire a token 24 hours after creation.
- Apply a 60-second per-account issuance cooldown, measured from the newest unused, unexpired verification token.
- Use separate constants, functions, database rows, URL paths, and email subjects from password-reset tokens. A verification token must never reset a password and a reset token must never verify an email.
- Keep `usedAt` for auditability. Do not rely only on deletion.
- Compare expiry against a transaction-local `now` during the conditional claim; page-level prevalidation is only a user-experience optimization.
- Never include an email, user ID, expiry, or other personal data in the raw token or verification URL.

The verification URL is:

```text
${APP_URL}/verify-email?token=<url-encoded-raw-token>
```

Never construct this URL from request headers and never log the complete URL.

## 7. Registration behavior

Route: `/signup`  
Fields: the existing `email`, `password`, and `confirmPassword`

Keep the current normalization, password policy, server-side Zod validation, duplicate constraint handling, and generic public errors. Replace the post-validation behavior with:

1. Generate one raw verification token and its hash.
2. Hash the password.
3. In one Prisma transaction, create the pending user and its verification-token row. Rely on the unique email constraint for concurrent duplicate registration.
4. Send the verification email after the transaction commits, using the token-row ID for provider idempotency.
5. Do not call Auth.js `signIn`, do not create an Auth.js cookie, and do not send the welcome email.
6. On successful submission and email handoff, redirect to `/verify-email/pending`.

The pending page must say:

`Check your email to verify your account before signing in.`

It must also link to `/verify-email/resend` and `/login`. Do not put the submitted email address in the redirect URL, local storage, or rendered page.

### 7.1 Failure behavior

- Invalid fields return the existing field-level errors.
- An email already belonging to either an active or pending user returns the same public message: `Unable to create an account with those details. Try signing in, resending verification, or resetting your password.`
- Hashing or database failure returns a generic retryable error and creates neither a partial user nor token row.
- If Resend fails after the transaction commits, keep the pending account, mark the just-created token used, and return: `Your account was created, but we could not send the verification email. Request a new link to continue.` Include a link to `/verify-email/resend`.
- Never attempt to sign the pending user in as a fallback.

The unique constraint remains the final defense against duplicate users. Do not implement “upsert and replace password” for an existing pending address; that would let another person who knows the address overwrite the original registrant's password.

## 8. Verification-email delivery

Add `emails/verify-email.tsx` and a `sendVerificationEmail(to, rawToken, tokenRowId)` helper to the existing mail module.

Required message contract:

- Subject: `Verify your Stash email`
- Explain that the recipient must verify the address before signing in.
- CTA text: `Verify email`
- Include the trusted verification URL.
- State that the link expires in 24 hours and can be used once.
- State that the recipient can ignore the email if they did not create a Stash account.
- Include an accessible plain-text alternative.
- Use the configured `EMAIL_FROM`; do not add a second sender setting.
- Use Resend idempotency key `email-verification/<token-row-id>`.

Extend the mail helper's email-kind union and safe structured logging. Logs may contain `kind`, token-row entity ID, provider email ID, and a sanitized error category. They must not contain the recipient, raw token, token hash, verification URL, email HTML/text, or provider response body.

Verification delivery is required for activation, unlike the post-activation welcome email. A delivery failure follows the recovery behavior in sections 7.1 and 10; it never marks the account verified.

## 9. Verification page and atomic activation

Routes:

- `/verify-email?token=<raw-token>` — validate and confirm a link
- `/verify-email/pending` — post-signup instructions
- `/verify-email/resend` — request a replacement link

### 9.1 GET/page behavior

The verification page is public. A GET request must not mutate account state. This avoids activating accounts through framework prefetching, link previews, antivirus scanners, or crawlers.

- Missing, malformed, expired, or used tokens show `This verification link is invalid or has expired.` and link to `/verify-email/resend`.
- A token that is currently valid renders a POST-backed form with a `Verify email` button. Carry the raw token in a hidden form value or a bound Server Action argument.
- Do not reveal the associated email address or user ID.
- Set the page referrer policy to `no-referrer` and avoid third-party assets, analytics, or external links on the token-bearing page.
- Ensure verification pages and action responses are not statically or publicly cached. Use the current Next.js request-time/no-store conventions appropriate to this repository.
- Authenticated active users visiting pending/resend pages may be redirected to `/`; the token page may instead show a non-sensitive “already signed in” state. Pending users never have a valid session.

The page-level validity lookup does not reserve or consume a token. It is acceptable for the token to become invalid between render and submit; the Server Action must handle that as the generic invalid/expired state.

### 9.2 Atomic activation transaction

The POST-backed Server Action must validate token shape before database work, hash it, and delegate to a server-only service. The service must activate atomically:

1. Look up the token hash only to obtain its `userId`; return the generic invalid result if absent.
2. In the same transaction, lock the owning user row (for example with PostgreSQL `SELECT ... FOR UPDATE`) so concurrent valid tokens for one user serialize.
3. Conditionally claim the submitted row only when `usedAt IS NULL` and `expiresAt > now`, setting `usedAt = now`.
4. If the claim count is not exactly one, change no account state and return the generic invalid/expired result.
5. Set `users.email_verified_at = now` only where the user ID matches and `email_verified_at IS NULL`.
6. If the conditional user update count is not one, treat the account as already active; do not overwrite its original verification time.
7. Mark every other still-unused verification token for that user used in the same transaction.
8. Return only the minimal server result needed to send the welcome email and redirect. Never return a Prisma `User` object to the client.

The lock plus conditional claims must ensure exactly one activation transition even when the same token, or two different valid tokens for one account, are submitted concurrently.

After a newly successful commit:

1. Log `email_verification.succeeded` with the user ID but no email or token data.
2. Send the existing welcome email using its existing `welcome-user/<user-id>` idempotency key.
3. Treat welcome delivery as best effort. Failure does not undo activation and shows no verification failure.
4. Redirect outside any caught `try` block to `/login?verified=success`.

The login page must show: `Your email has been verified. Sign in to continue.`

An invalid submission remains on a safe verification result state and shows the same invalid/expired message used for a bad GET. Repeated submission after success must not send another welcome email or change `emailVerifiedAt`.

## 10. Resend-verification flow

Route: `/verify-email/resend`  
Field: `email`

Use the existing email schema and normalization. For every syntactically valid input, return the same public success state:

`If an unverified account exists for that email, we sent a new verification link.`

For a pending user:

1. Pass through the recovery/abuse-rate-limit abstraction using the normalized email.
2. Serialize issuance for that user across app instances using a PostgreSQL transaction advisory lock or an equally strong per-user database lock.
3. If the newest unused, unexpired verification token was created less than 60 seconds ago, create and send nothing and return the generic success state.
4. Otherwise generate a new token. In one transaction, mark all older unused verification tokens used and create the replacement row with a 24-hour expiry.
5. After commit, send the new verification email with the replacement row's idempotency key.
6. If sending fails, mark that replacement row used so an undelivered link does not impose the cooldown, log a sanitized failure, and still return the generic public state.

For an active user or unknown email:

- Create no token and send no email.
- Perform the existing precomputed dummy bcrypt check so these paths do not have an obvious fast timing path.
- Return exactly the same public result as for a pending user.

Do not return “already verified,” “account not found,” cooldown status, provider status, or token state. Do not prefill or echo the submitted email after the success state. Apply the same no-store and accessible form-state conventions as the existing forgot-password flow.

The 60-second database cooldown is only one layer. Keep a clear extension point for a durable distributed limiter by IP and normalized-email digest before production at scale; never log the normalized address from limiter keys.

## 11. Sign-in and authorization changes

### 11.1 Credentials provider

In `auth.ts`, select `emailVerifiedAt` with the password hash and session version. Preserve the existing unknown-user dummy comparison and generic credential failure behavior.

For a found user:

1. Compare the password first.
2. If the password is wrong, return the existing generic failure.
3. If the password is correct but `emailVerifiedAt` is null, reject authorization and create no session.
4. Only an active user may be returned from `authorize`.

The public login result for unknown email, wrong password, malformed input, and a correct password on a pending account remains exactly `Invalid email or password.` This avoids adding an account-status oracle to the login endpoint. Add a permanently visible `Resend verification email` link to `/verify-email/resend` so a legitimate pending user has a recovery path.

Do not put `emailVerifiedAt` in the encrypted session payload; the DAL must read current state from the database. No `sessionVersion` increment is needed during initial activation because pending accounts cannot receive a valid session.

### 11.2 Web DAL and same-origin routes

Update `getCurrentUser()` so its explicit user query includes `emailVerifiedAt` and returns `null` when it is null, in addition to the existing missing-user and session-version checks. Continue returning only `{ id, email }` as `SafeUser`.

`requireUser()` and `requireApiUser()` then fail closed for pending accounts. Every authenticated page, bookmark operation, chat handler, and cookie-authenticated MCP path must continue using these helpers near data access.

### 11.3 Remote MCP bearer tokens

Update the remote MCP subject-to-user lookup in `lib/mcp-auth/token-verifier.ts` (and any shared authentication helper it uses) to require `emailVerifiedAt` to be non-null as well as a matching local user and `sessionVersion`. A syntactically and cryptographically valid bearer token for a pending local user must receive the existing unauthorized response and must not access bookmark data.

This check is required even though normal Credentials sign-in blocks pending users: the external issuer is a separate authorization path and cannot be assumed to know local activation state.

## 12. Password-reset interaction

Email verification and password recovery remain separate proofs with separate tokens.

- `requestPasswordReset` must select `emailVerifiedAt`.
- For an unknown or pending user, perform the dummy password check, create no reset-token row, send no reset email, and return the existing generic reset-request response.
- For an active user, preserve all current cooldown, delivery-failure, hashing, expiry, and atomic-consumption behavior.
- `consumeResetToken` must never set `emailVerifiedAt`.
- A reset token created before an account is administratively returned to a pending state, if that state is ever introduced later, must not activate it. This phase does not add an “unverify” operation.

The visible forgot-password response remains: `If an account exists for that email, we sent a password reset link.` Do not change it to disclose verification state.

## 13. Welcome-email timing

The existing welcome/onboarding email moves from registration to first successful verification.

- Do not send it when the pending user row is created.
- Send it only after the activation transaction commits and only when that transaction performed the null-to-timestamp transition.
- Preserve its current recipient, content, CTA, and `welcome-user/<user-id>` idempotency key.
- A returned or thrown Resend error remains best effort and must not roll back, clear, or hide successful verification.
- Verification retries, already-active results, and replacement-token issuance must not send welcome email.

## 14. Suggested implementation layout

```text
app/
  (auth)/
    verify-email/
      page.tsx
      verify-email-form.tsx
      pending/
        page.tsx
      resend/
        page.tsx
        resend-verification-form.tsx
auth.ts
emails/
  verify-email.tsx
lib/
  auth-actions.ts
  auth-dal.ts
  auth-schemas.ts
  auth-service.ts
  email-verification-token.ts
  mail.tsx
  mcp-auth/
    token-verifier.ts
prisma/
  migrations/
    <timestamp>_add_email_verification/
      migration.sql
  schema.prisma
```

The exact service split may differ, but Client Components must not import Prisma, raw environment values, Node crypto, Resend, token helpers, or password helpers. Server Actions should validate/serialize form state and delegate token/account operations to server-only services.

## 15. Error handling, privacy, and observability

### 15.1 Public messages

Use these exact generic messages where specified:

- Duplicate registration: `Unable to create an account with those details. Try signing in, resending verification, or resetting your password.`
- Login failure: `Invalid email or password.`
- Resend success: `If an unverified account exists for that email, we sent a new verification link.`
- Invalid verification token: `This verification link is invalid or has expired.`
- Verification success: `Your email has been verified. Sign in to continue.`

Never expose Prisma errors, token status, token hashes, Auth.js codes, stack traces, Resend details, environment values, or whether an email belongs to an active/pending/unknown account.

### 15.2 Structured logs

Add events consistent with the current JSON logging style:

- `email_verification.issued`
- `email_verification.request_accepted`
- `email_verification.succeeded`
- `email_verification.token_rejected`
- existing `email.sent` / `email.failed` with kind `email-verification`

Allowed fields include a user ID after a known-user state change, token-row ID as a delivery entity ID, and a coarse category such as `invalid_or_expired`, `cooldown`, or `internal`. Do not log the email address, raw token, token hash, full URL, form body, password, cookie, bearer token, or a distinction between unknown and active addresses on public resend requests.

Avoid logging normal invalid-link query strings through application logs or error-reporting breadcrumbs. Configure any surrounding request logger to redact the `token` query parameter if it currently records URLs.

## 16. Accessibility and UX requirements

- Every email and form CTA must have an unambiguous accessible name.
- Error/success messages must use the existing announced form-status pattern (`role="alert"`, `aria-live`, or the repository's equivalent).
- Disable submit buttons while their action is pending, without relying on disabled state as a server-side replay defense.
- Preserve the email field after validation errors, but never preserve passwords or raw tokens in visible form controls.
- Provide navigation among signup, login, resend verification, and forgot password without requiring browser history.
- Do not use client-only redirects for successful security-sensitive actions. Server Actions must perform the canonical redirect.
- The token-bearing verification page must work with JavaScript disabled: GET renders the confirmation form and form submission receives a 303-style redirect after success through the current Next.js Server Action behavior.

## 17. Testing requirements

Tests must not call the real Resend API. Mock the provider at the existing mail-helper boundary or use a local test mail sink that never performs external delivery.

### 17.1 Unit tests

- Verification tokens contain 256 bits of entropy, have the canonical base64url shape, and hash to deterministic lowercase SHA-256 without exposing the raw value.
- Token/email schemas reject missing, malformed, padded, too-short, and too-long values.
- Verification email uses the configured sender, intended recipient, exact subject, React and plain-text content, trusted `APP_URL`, 24-hour wording, and `email-verification/<row-id>` idempotency key.
- Returned and thrown Resend failures are sanitized and treated as delivery failures.
- Login authorization rejects a pending user even with the correct password, accepts an active user with the correct password, and preserves dummy/wrong-password behavior.
- The auth DAL rejects a null verification timestamp and returns only safe fields for an active current session.
- Remote MCP token verification rejects a pending local user.
- Password-reset requests treat pending and unknown users equivalently and do not call reset delivery.
- Server Action states contain no token, hash, password, environment data, or raw database object.

### 17.2 Database/integration tests

- A new registration transaction stores a normalized email, bcrypt hash, `emailVerifiedAt = null`, and one hashed verification token; it never stores the raw token.
- A database or transaction failure leaves neither a partial user nor token.
- Concurrent duplicate registration creates exactly one pending user and does not replace its password.
- Verification-email failure leaves the user pending and invalidates the undelivered token.
- Resend for unknown and active addresses creates no token; resend for pending creates one replacement.
- Concurrent resend requests respect the 60-second cooldown and create/send at most one new token.
- Replacement issuance invalidates every older unused verification token.
- Resend delivery failure marks the replacement used so an immediate retry is not blocked.
- Expired, malformed, missing, and already-used tokens cannot activate a user.
- Two concurrent submissions of one token yield exactly one activation transition.
- Concurrent submissions of two different valid tokens for one user still yield exactly one activation transition and one first verification timestamp.
- Successful activation sets `emailVerifiedAt` once and marks all sibling verification tokens used.
- Replaying a token does not change the timestamp or trigger another welcome email.
- Cascading deletion of a user removes verification-token rows.
- Pending users receive no password-reset token; active users retain the current reset behavior.
- Migration testing proves pre-migration users are backfilled active while post-migration inserts without `emailVerifiedAt` remain pending.

### 17.3 Browser/end-to-end tests

- Anonymous access to `/` still redirects to `/login`.
- Signup redirects to the pending page and does not authenticate the new user.
- The pending page contains verification, resend, and login guidance without exposing the submitted email.
- A pending user cannot sign in with the correct password and sees only the generic login error.
- Invalid and expired verification links show the generic state and resend link.
- A GET to a valid verification URL does not activate the account; activation occurs only after the confirmation form is submitted.
- A valid token activates once, redirects to the verified login success banner, and then permits sign-in.
- Reusing the link shows the invalid/expired state and does not resend welcome mail.
- The resend form always shows the same success copy for pending, active, and unknown addresses.
- An authenticated active user is redirected away from signup, login, pending, and resend pages according to the auth-shell convention.
- The verification page sends or declares a `no-referrer` policy and does not request third-party resources.

E2E tests may inject a known raw token and its hash into the isolated test database or capture mail through a test-only sink. Never add a production endpoint that exposes raw tokens. Keep all database tests on an isolated database whose name is explicitly recognized as a test database.

### 17.4 Regression coverage

Update existing fixtures that are intended to represent established users so they set `emailVerifiedAt` explicitly. Do not weaken the new default by making all test-created users active automatically. Preserve regression coverage for:

- Correct-password login for active users.
- Password reset and session-version revocation.
- Bookmark ownership and same-origin MCP authorization.
- Remote MCP bearer authorization.
- Welcome and password-reset email contracts.
- Generic registration, login, and recovery messages.

## 18. Documentation and operational requirements

Update README setup and flow documentation to explain:

- New accounts cannot sign in until verification completes.
- Verification links last 24 hours and replacement requests have a 60-second per-account cooldown.
- `APP_URL` is used as the trusted verification-link origin.
- `EMAIL_FROM` must use a Resend-verified production domain.
- Existing accounts are activated by the migration backfill.
- How local/test verification mail is captured or disabled without using a real recipient.
- How to run the new migration and tests without resetting the developer database.

No new environment variable is required. Do not commit real keys, real addresses, raw captured links, or `.env` contents.

Production deployment must use HTTPS. Confirm that request/access logs and error monitoring redact the `token` query parameter before enabling verification emails in production.

## 19. Implementation sequence

1. Add token helpers and tests.
2. Add the nullable user field, verification-token model, forward migration, and generated Prisma client.
3. Add verification email content and mail-helper tests.
4. Change registration to atomically create a pending user/token and stop automatic sign-in/welcome delivery.
5. Add the pending, confirm, and resend pages/actions/services.
6. Gate Credentials authorization, the web DAL, same-origin API/MCP paths, and remote MCP mapping on active state.
7. Move welcome delivery to the successful activation transition and gate password-reset issuance on active state.
8. Update fixtures and add concurrency, integration, browser, migration, privacy, and accessibility coverage.
9. Update README and run the full verification suite.

## 20. Required verification commands

Run and fix all failures from:

```bash
pnpm prisma:format
pnpm prisma:validate
pnpm prisma:generate
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Run migration-based integration and browser tests only against an isolated, migrated test database. Never reset the developer or production database without explicit approval.

## 21. Definition of done

The feature is complete only when:

- New users remain pending after signup and receive no session.
- Existing users remain active through an explicit migration backfill.
- Verification tokens are random, hashed at rest, expiring, purpose-specific, single-use under concurrency, and invalidated on replacement.
- A state-changing GET is not used for activation.
- Exactly one successful activation sets the immutable first-verification timestamp and triggers at most one idempotent welcome email.
- Pending users fail closed across Credentials, web DAL, API/chat, same-origin MCP, remote MCP, and password-reset issuance paths.
- Resend responses do not disclose account existence or status and delivery failures allow safe retry.
- No raw token, password, recipient address, secret, or sensitive URL is stored in logs or serialized action state.
- The new UI is accessible, progressively enhanced, no-store, and protected by a no-referrer policy on token-bearing pages.
- Prisma validation/generation, lint, unit tests, integration tests, browser tests, and production build pass.
- README documents the user flow, migration compatibility, email setup, test strategy, and production logging requirement.
