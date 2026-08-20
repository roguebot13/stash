import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
export const RESET_TOKEN_COOLDOWN_MS = 60 * 1000;
export const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateResetToken() {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isResetTokenShapeValid(token: unknown): token is string {
  return typeof token === "string" && RESET_TOKEN_PATTERN.test(token);
}
