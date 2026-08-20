import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: sendMock }; } }));

import { resetEnvCacheForTests } from "@/lib/env";
import { sendPasswordResetEmail, sendWelcomeEmail } from "@/lib/mail";

describe("mail helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.AUTH_SECRET = "x".repeat(32);
    process.env.APP_URL = "https://stash.example/";
    process.env.MCP_AUTH_ISSUER = "https://auth.stash.example";
    process.env.EMAIL_FROM = "Stash <hello@stash.example>";
    delete process.env.AUTH_TEST_MAIL_MODE;
    resetEnvCacheForTests();
  });

  it("sends welcome content and entity idempotency", async () => {
    sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
    await sendWelcomeEmail("person@example.com", "user-1");
    expect(sendMock).toHaveBeenCalledOnce();
    const [payload, options] = sendMock.mock.calls[0];
    expect(payload).toMatchObject({ from: "Stash <hello@stash.example>", to: "person@example.com", subject: "Welcome to Stash" });
    expect(payload.react.props.appUrl).toBe("https://stash.example/");
    expect(payload.text).toContain("https://stash.example/");
    expect(options).toEqual({ idempotencyKey: "welcome-user/user-1" });
  });

  it("sends reset content and token-row idempotency", async () => {
    sendMock.mockResolvedValue({ data: { id: "email-2" }, error: null });
    await sendPasswordResetEmail("person@example.com", "abc_DEF-123", "token-row-1");
    const [payload, options] = sendMock.mock.calls[0];
    expect(payload.subject).toBe("Reset your Stash password");
    expect(payload.react.props.resetUrl).toBe("https://stash.example/reset-password?token=abc_DEF-123");
    expect(payload.text).toContain("expires in 60 minutes");
    expect(options).toEqual({ idempotencyKey: "password-reset/token-row-1" });
  });

  it("treats a returned Resend error as failure", async () => {
    sendMock.mockResolvedValue({ data: null, error: { name: "validation_error", message: "bad request" } });
    await expect(sendWelcomeEmail("person@example.com", "user-2")).rejects.toThrow("Email delivery failed");
  });

  it("treats a thrown Resend error as failure", async () => {
    sendMock.mockRejectedValue(new Error("network down"));
    await expect(sendWelcomeEmail("person@example.com", "user-3")).rejects.toThrow("Email delivery failed");
  });
});
