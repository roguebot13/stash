import { describe, expect, it } from "vitest";

import {
  generateEmailVerificationToken,
  hashEmailVerificationToken,
  isEmailVerificationTokenShapeValid,
} from "@/lib/email-verification-token";

describe("email verification tokens", () => {
  it("generates canonical 256-bit base64url tokens", () => {
    const first = generateEmailVerificationToken();
    const second = generateEmailVerificationToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first, "base64url")).toHaveLength(32);
    expect(second).not.toBe(first);
    expect(isEmailVerificationTokenShapeValid(first)).toBe(true);
    expect(isEmailVerificationTokenShapeValid(`${first}=`)).toBe(false);
  });

  it("uses a deterministic lowercase SHA-256 digest", () => {
    const token = "a".repeat(43);
    expect(hashEmailVerificationToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashEmailVerificationToken(token)).toBe(hashEmailVerificationToken(token));
    expect(hashEmailVerificationToken(token)).not.toContain(token);
  });
});
