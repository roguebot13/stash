import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/app/(auth)/auth-shell";
import { ForgotPasswordForm } from "@/app/(auth)/forgot-password/forgot-password-form";
import { getCurrentUser } from "@/lib/auth-dal";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/");
  return <AuthShell title="Reset your password" description="Enter your email and we’ll send a secure, one-time reset link." footer={<p><Link href="/login">Back to sign in</Link></p>}><ForgotPasswordForm /></AuthShell>;
}
