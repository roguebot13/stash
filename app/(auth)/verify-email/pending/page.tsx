import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/app/(auth)/auth-shell";
import { getCurrentUser } from "@/lib/auth-dal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function VerificationPendingPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthShell
      title="Check your inbox"
      description="Check your email to verify your account before signing in."
      footer={<><p><Link href="/verify-email/resend">Resend verification email</Link></p><p><Link href="/login">Back to sign in</Link></p></>}
    >
      <p className="notice success" role="status">We sent a one-time link that expires in 24 hours.</p>
    </AuthShell>
  );
}
