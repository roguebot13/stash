import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/app/(auth)/auth-shell";
import { ResendVerificationForm } from "@/app/(auth)/verify-email/resend/resend-verification-form";
import { getCurrentUser } from "@/lib/auth-dal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ResendVerificationPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthShell
      title="Resend verification"
      description="Enter your email and we’ll send a new link if your account is waiting for verification."
      footer={<p><Link href="/login">Back to sign in</Link></p>}
    >
      <ResendVerificationForm />
    </AuthShell>
  );
}
