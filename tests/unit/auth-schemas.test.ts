import { describe, expect, it } from "vitest";
import {
  forgotPasswordSchema,
  normalizeEmail,
  registrationSchema,
  resetPasswordSchema,
  safeReturnTo,
  signInSchema,
} from "@/lib/auth-schemas";

describe("auth schemas", () => {
  it("normalizes email consistently", () => {
    expect(normalizeEmail("  Person@Example.COM ")).toBe("person@example.com");
    expect(forgotPasswordSchema.parse({ email: " A@EXAMPLE.com " }).email).toBe("a@example.com");
  });

  it("enforces password length without transforming the password", () => {
    expect(signInSchema.parse({ email: "a@example.com", password: " twelve chars " }).password).toBe(" twelve chars ");
    expect(signInSchema.safeParse({ email: "a@example.com", password: "short" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "a@example.com", password: "😀".repeat(19) }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "a@example.com", password: "😀".repeat(18) }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "a@example.com", password: "123456789012" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "a@example.com", password: "12345678901" }).success).toBe(false);
  });

  it("requires matching password confirmation", () => {
    const result = registrationSchema.safeParse({ email: "a@example.com", password: "correct horse", confirmPassword: "different one" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.confirmPassword).toContain("Passwords do not match.");
  });

  it("rejects malformed email and reset-token inputs", () => {
    expect(forgotPasswordSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "not-a-token", password: "a strong password", confirmPassword: "a strong password" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "a".repeat(43), password: "a strong password", confirmPassword: "different value" }).success).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it.each(["/", "/bookmarks", "/bookmarks?tag=work", "/a//b"])("accepts internal path %s", (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  it.each(["https://example.com", "//example.com", "javascript:alert(1)", "bookmarks", ""])("rejects unsafe path %s", (path) => {
    expect(safeReturnTo(path)).toBe("/");
  });
});
