import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/app/(auth)/auth-shell";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { safeReturnTo } from "@/lib/auth-schemas";
import { getCurrentUser } from "@/lib/auth-dal";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; reset?: string; verified?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const params = await searchParams;
  return <AuthShell title="Welcome back" description="Sign in to return to your saved corners of the web." footer={<p>New to Stash? <Link href="/signup">Create an account</Link></p>}>
    {params.reset === "success" ? <p className="notice success" role="status">Your password has been reset. Sign in with your new password.</p> : null}
    {params.verified === "success" ? <p className="notice success" role="status">Your email has been verified. Sign in to continue.</p> : null}
    <LoginForm returnTo={safeReturnTo(params.returnTo)} />
  </AuthShell>;
}
