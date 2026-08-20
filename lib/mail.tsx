import "server-only";

import { Resend } from "resend";

import { PasswordResetEmail } from "@/emails/password-reset-email";
import { WelcomeEmail } from "@/emails/welcome-email";
import { getServerEnv } from "@/lib/env";

type EmailKind = "welcome" | "password-reset";

function sanitizeEmailError(error: unknown) {
  if (error && typeof error === "object") {
    const value = error as { name?: unknown; message?: unknown; code?: unknown };
    const rawCode = typeof value.code === "string" ? value.code : typeof value.name === "string" ? value.name : "unknown";
    console.error(error);
    return {
      code: /^[a-z0-9_-]{1,64}$/i.test(rawCode) ? rawCode : "unknown",
      message: "Email provider rejected the request",
    };
  }
  return { code: "unknown", message: "Email delivery failed" };
}

async function deliver(
  kind: EmailKind,
  entityId: string,
  payload: Parameters<Resend["emails"]["send"]>[0],
  idempotencyKey: string,
) {
  const env = getServerEnv();
  const resend = new Resend(env.RESEND_API_KEY);

  try {
    if (process.env.AUTH_TEST_MAIL_MODE === "disabled" && process.env.NODE_ENV !== "production") {
      return { id: `test-${kind}-${entityId}` };
    }
    const { data, error } = await resend.emails.send(payload, { idempotencyKey });
    if (error) throw error;
    console.info(JSON.stringify({ event: "email.sent", kind, entityId, emailId: data?.id }));
    return data;
  } catch (error) {
    console.error(
      JSON.stringify({ event: "email.failed", kind, entityId, ...sanitizeEmailError(error) }),
    );
    throw new Error("Email delivery failed");
  }
}

export async function sendWelcomeEmail(to: string, userId: string) {
  const env = getServerEnv();
  return deliver(
    "welcome",
    userId,
    {
      from: env.EMAIL_FROM,
      to,
      subject: "Welcome to Stash",
      react: <WelcomeEmail appUrl={`${env.APP_URL}/`} />,
      text: `Welcome to Stash. Save and manage your bookmarks in one place. Open Stash: ${env.APP_URL}/`,
    },
    `welcome-user/${userId}`,
  );
}

export async function sendPasswordResetEmail(to: string, token: string, tokenId: string) {
  const env = getServerEnv();
  const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  return deliver(
    "password-reset",
    tokenId,
    {
      from: env.EMAIL_FROM,
      to,
      subject: "Reset your Stash password",
      react: <PasswordResetEmail resetUrl={resetUrl} />,
      text: `Reset your Stash password: ${resetUrl}\n\nThis link expires in 60 minutes and can be used once. If you did not request it, ignore this email.`,
    },
    `password-reset/${tokenId}`,
  );
}
