import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/app/(auth)/auth-shell";
import { SignupForm } from "@/app/(auth)/signup/signup-form";
import { getCurrentUser } from "@/lib/auth-dal";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/");
  return <AuthShell title="Make a place for what matters" description="Create your Stash account and keep the links worth returning to." footer={<p>Already have an account? <Link href="/login">Sign in</Link></p>}><SignupForm /></AuthShell>;
}
