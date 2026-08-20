import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateResetToken, hashResetToken, isResetTokenShapeValid } from "@/lib/reset-token";

describe("reset tokens", () => {
  it("generates 256-bit base64url tokens", () => {
    const tokens = new Set(Array.from({ length: 64 }, generateResetToken));
    expect(tokens.size).toBe(64);
    for (const token of tokens) {
      expect(token).toHaveLength(43);
      expect(isResetTokenShapeValid(token)).toBe(true);
    }
  });

  it("uses a deterministic lowercase SHA-256 digest", () => {
    const token = generateResetToken();
    const expected = createHash("sha256").update(token, "utf8").digest("hex");
    expect(hashResetToken(token)).toBe(expected);
    expect(hashResetToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashResetToken(token)).not.toContain(token);
  });
});
