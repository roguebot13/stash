# Stash

Stash is a Next.js App Router application with first-party email/password authentication, stateless Auth.js sessions, Prisma/PostgreSQL persistence, and transactional email through Resend.

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env` and replace every placeholder. Never commit `.env`.
3. Generate `AUTH_SECRET` with `pnpm exec auth secret` (or another cryptographically secure generator).
4. Set `APP_URL` to the trusted public origin, normally `http://localhost:3000` locally. Production must use HTTPS.
5. Configure `EMAIL_FROM` with a sender on a domain verified in Resend.
6. Apply migrations with `pnpm prisma migrate dev`. The committed initial migration creates only `users` and `password_reset_tokens`.
7. Start the application with `pnpm dev`.

The server validates `DATABASE_URL`, `RESEND_API_KEY`, `AUTH_SECRET`, `APP_URL`, and `EMAIL_FROM` on first authentication use and reports invalid variable names without printing their values.

## Authentication behavior

- `/signup` creates a credentials user, sends a best-effort welcome email, and signs the user in.
- `/login` creates a seven-day encrypted, HTTP-only Auth.js cookie session.
- `/forgot-password` always returns an account-enumeration-resistant response for valid email syntax.
- `/reset-password` consumes a SHA-256-hashed, 60-minute, single-use token and revokes older sessions by incrementing the user's session version.
- `/` authorizes against the current database record through the DAL before rendering.

`lib/rate-limit.ts` is the extension point for a future shared IP/email limiter. The database-backed 60-second per-account cooldown is not a complete production abuse-control system by itself.

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
