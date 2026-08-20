import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("verifies only the matching password", async () => {
    const hash = await hashPassword("a correct password");
    await expect(verifyPassword("a correct password", hash)).resolves.toBe(true);
    await expect(verifyPassword("the wrong password", hash)).resolves.toBe(false);
    expect(hash).not.toContain("a correct password");
  });

  it("uses a fresh bcrypt salt", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(first).not.toBe(second);
  });
});
