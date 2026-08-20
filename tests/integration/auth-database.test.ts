import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { registrationSchema } from "@/lib/auth-schemas";
import { generateEmailVerificationToken, hashEmailVerificationToken } from "@/lib/email-verification-token";
import { hashPassword, verifyPassword } from "@/lib/password";
import { generateResetToken, hashResetToken } from "@/lib/reset-token";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl ? new URL(testDatabaseUrl).pathname.toLowerCase() : "";
const hasIsolatedDatabase = Boolean(testDatabaseUrl && databaseName.includes("test"));

describe.skipIf(!hasIsolatedDatabase)("authentication database flows", () => {
  let db: PrismaClient;
  let service: typeof import("@/lib/auth-service");

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_SECRET = "x".repeat(32);
    process.env.APP_URL = "http://localhost:3000";
    process.env.MCP_AUTH_ISSUER = "http://localhost:4000";
    process.env.EMAIL_FROM = "Stash <test@example.com>";
    process.env.AUTH_TEST_MAIL_MODE = "disabled";
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl! }) });
    service = await import("@/lib/auth-service");
  });

  beforeEach(async () => {
    await db.emailVerificationToken.deleteMany();
    await db.passwordResetToken.deleteMany();
    await db.user.deleteMany();
  });

  afterAll(async () => { await db?.$disconnect(); });

  async function createActiveUser(email: string, password: string) {
    const registration = await service.createPendingCredentialsUser(email, password);
    await db.user.update({
      where: { id: registration.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    return registration.user;
  }

  it("stores a pending user, salted bcrypt hash, and hashed verification token, and rejects duplicates", async () => {
    const input = registrationSchema.parse({ email: " Person@EXAMPLE.com ", password: "a strong password", confirmPassword: "a strong password" });
    const registration = await service.createPendingCredentialsUser(input.email, input.password);
    const stored = await db.user.findUniqueOrThrow({ where: { id: registration.user.id } });
    expect(stored.email).toBe("person@example.com");
    expect(stored.emailVerifiedAt).toBeNull();
    expect(stored.passwordHash).not.toContain(input.password);
    await expect(verifyPassword(input.password, stored.passwordHash)).resolves.toBe(true);
    const token = await db.emailVerificationToken.findUniqueOrThrow({
      where: { tokenHash: hashEmailVerificationToken(registration.rawToken) },
    });
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.tokenHash).not.toBe(registration.rawToken);
    const results = await Promise.allSettled([
      service.createPendingCredentialsUser(input.email, input.password),
      service.createPendingCredentialsUser(input.email, input.password),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(0);
    expect(await db.user.count()).toBe(1);
  });

  it("atomically activates once and invalidates sibling verification tokens", async () => {
    const registration = await service.createPendingCredentialsUser("person@example.com", "a strong password");
    const siblingRaw = generateEmailVerificationToken();
    await db.emailVerificationToken.create({
      data: {
        userId: registration.user.id,
        tokenHash: hashEmailVerificationToken(siblingRaw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const results = await Promise.all([
      service.consumeEmailVerificationToken(registration.rawToken),
      service.consumeEmailVerificationToken(registration.rawToken),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const active = await db.user.findUniqueOrThrow({ where: { id: registration.user.id } });
    expect(active.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await db.emailVerificationToken.count({ where: { userId: active.id, usedAt: null } })).toBe(0);
    await expect(service.consumeEmailVerificationToken(siblingRaw)).resolves.toBeNull();
  });

  it("resends only for pending users and applies the verification cooldown", async () => {
    const pending = await service.createPendingCredentialsUser("pending@example.com", "a strong password");
    await db.emailVerificationToken.updateMany({
      where: { userId: pending.user.id },
      data: { usedAt: new Date() },
    });
    await service.requestEmailVerification("pending@example.com");
    await service.requestEmailVerification("pending@example.com");
    expect(await db.emailVerificationToken.count({ where: { userId: pending.user.id, usedAt: null } })).toBe(1);

    await createActiveUser("active@example.com", "a strong password");
    await service.requestEmailVerification("active@example.com");
    await service.requestEmailVerification("missing@example.com");
    expect(await db.user.count()).toBe(2);
  });

  it("applies the reset-request cooldown without storing a raw token", async () => {
    await createActiveUser("person@example.com", "a strong password");
    await service.requestPasswordReset("person@example.com");
    await service.requestPasswordReset("person@example.com");
    const tokens = await db.passwordResetToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokens[0].tokenHash).toHaveLength(64);
    await service.requestPasswordReset("missing@example.com");
    expect(await db.passwordResetToken.count()).toBe(1);
  });

  it("does not issue password-reset tokens for pending users", async () => {
    await service.createPendingCredentialsUser("pending@example.com", "a strong password");
    await service.requestPasswordReset("pending@example.com");
    expect(await db.passwordResetToken.count()).toBe(0);
  });

  it("atomically consumes a token, updates the password, invalidates siblings, and increments the session version", async () => {
    const user = await createActiveUser("person@example.com", "old password value");
    const firstRaw = generateResetToken();
    const secondRaw = generateResetToken();
    await db.passwordResetToken.createMany({ data: [
      { userId: user.id, tokenHash: hashResetToken(firstRaw), expiresAt: new Date(Date.now() + 60_000) },
      { userId: user.id, tokenHash: hashResetToken(secondRaw), expiresAt: new Date(Date.now() + 60_000) },
    ] });

    const results = await Promise.all([
      service.consumeResetToken(firstRaw, "new password value"),
      service.consumeResetToken(firstRaw, "new password value"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.sessionVersion).toBe(1);
    await expect(verifyPassword("old password value", updated.passwordHash)).resolves.toBe(false);
    await expect(verifyPassword("new password value", updated.passwordHash)).resolves.toBe(true);
    expect(await db.passwordResetToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
    await expect(service.consumeResetToken(secondRaw, "another password")).resolves.toBe(false);
  });

  it("rejects expired and used tokens and cascades token deletion", async () => {
    const user = await createActiveUser("person@example.com", "old password value");
    const raw = generateResetToken();
    await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashResetToken(raw), expiresAt: new Date(Date.now() - 1) } });
    await expect(service.consumeResetToken(raw, "new password value")).resolves.toBe(false);
    await db.user.delete({ where: { id: user.id } });
    expect(await db.passwordResetToken.count()).toBe(0);
    expect(await db.emailVerificationToken.count()).toBe(0);
  });

  it("recognizes a correct credentials password only", async () => {
    const passwordHash = await hashPassword("correct password");
    await expect(verifyPassword("correct password", passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("incorrect password", passwordHash)).resolves.toBe(false);
  });
});
