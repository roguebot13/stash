import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/app/(auth)/auth-shell";
import { VerifyEmailForm } from "@/app/(auth)/verify-email/verify-email-form";
import {
  INVALID_VERIFICATION_TOKEN_MESSAGE,
  isEmailVerificationTokenActive,
} from "@/lib/auth-service";
import { isEmailVerificationTokenShapeValid } from "@/lib/email-verification-token";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const valid =
    isEmailVerificationTokenShapeValid(token) &&
    (await isEmailVerificationTokenActive(token));

  return (
    <AuthShell
      title="Verify your email"
      description="Confirm your email address to activate your Stash account."
      footer={<p><Link href="/verify-email/resend">Request a new verification link</Link></p>}
    >
      {valid ? (
        <VerifyEmailForm token={token} />
      ) : (
        <p className="notice error" role="alert">{INVALID_VERIFICATION_TOKEN_MESSAGE}</p>
      )}
    </AuthShell>
  );
}
