import "server-only";

import { sendPasswordResetEmail } from "@/lib/mail";
import { hashPassword, performDummyPasswordCheck } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { checkRecoveryRateLimit } from "@/lib/rate-limit";
import {
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_COOLDOWN_MS,
  RESET_TOKEN_TTL_MS,
} from "@/lib/reset-token";

export const GENERIC_RESET_REQUEST_MESSAGE =
  "If an account exists for that email, we sent a password reset link.";
export const INVALID_RESET_TOKEN_MESSAGE = "This reset link is invalid or has expired.";

export function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export async function createCredentialsUser(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  return prisma.user.create({
    data: { email, passwordHash },
    select: { id: true, email: true },
  });
}

export async function requestPasswordReset(normalizedEmail: string) {
  await checkRecoveryRateLimit({ normalizedEmail });
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true },
  });

  if (!user) {
    await performDummyPasswordCheck("");
    console.info(JSON.stringify({ event: "password_reset.request_accepted" }));
    return;
  }

  const now = new Date();
  const rawToken = generateResetToken();
  const tokenHash = hashResetToken(rawToken);
  const tokenRow = await prisma.$transaction(async (tx) => {
    // Serialize requests for one account across application instances.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))::text AS locked`;
    const newest = await tx.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (newest && now.getTime() - newest.createdAt.getTime() < RESET_TOKEN_COOLDOWN_MS) {
      return null;
    }
    return tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      },
      select: { id: true },
    });
  });

  if (tokenRow) {
    try {
      await sendPasswordResetEmail(user.email, rawToken, tokenRow.id);
    } catch {
      await prisma.passwordResetToken.updateMany({
        where: { id: tokenRow.id, usedAt: null },
        data: { usedAt: new Date() },
      });
    }
  }
  console.info(JSON.stringify({ event: "password_reset.request_accepted" }));
}

export async function isResetTokenActive(rawToken: string) {
  const row = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash: hashResetToken(rawToken),
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function consumeResetToken(rawToken: string, newPassword: string) {
  const tokenHash = hashResetToken(rawToken);
  const passwordHash = await hashPassword(newPassword);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      console.info(JSON.stringify({ event: "password_reset.token_rejected", category: "invalid_or_expired" }));
      return false;
    }
    const token = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!token) throw new Error("Claimed password reset token disappeared");
    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
      select: { id: true },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: token.userId, usedAt: null },
      data: { usedAt: now },
    });
    console.info(JSON.stringify({ event: "password_reset.succeeded", userId: token.userId }));
    return true;
  });
}
