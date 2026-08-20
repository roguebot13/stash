import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_TOKEN_COOLDOWN_MS = 60 * 1000;
export const EMAIL_VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateEmailVerificationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashEmailVerificationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isEmailVerificationTokenShapeValid(token: unknown): token is string {
  return typeof token === "string" && EMAIL_VERIFICATION_TOKEN_PATTERN.test(token);
}
