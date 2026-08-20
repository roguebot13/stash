import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/app/(auth)/auth-shell";
import { ResetPasswordForm } from "@/app/(auth)/reset-password/reset-password-form";
import { INVALID_RESET_TOKEN_MESSAGE, isResetTokenActive } from "@/lib/auth-service";
import { isResetTokenShapeValid } from "@/lib/reset-token";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const valid = isResetTokenShapeValid(token) && (await isResetTokenActive(token));
  return <AuthShell title="Choose a new password" description="Use a strong password you do not use elsewhere." footer={<p><Link href="/forgot-password">Request a new reset link</Link></p>}>
    {valid ? <ResetPasswordForm token={token} /> : <p className="notice error" role="alert">{INVALID_RESET_TOKEN_MESSAGE}</p>}
  </AuthShell>;
}
