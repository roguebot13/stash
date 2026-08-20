"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/lib/auth-actions";
import { initialAuthActionState } from "@/lib/auth-state";

export function LoginForm({ returnTo = "/" }: { returnTo?: string }) {
  const [state, action, pending] = useActionState(loginAction, initialAuthActionState);
  return <form action={action} className="auth-form">
    <input type="hidden" name="returnTo" value={returnTo} />
    <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} aria-invalid={state.status === "error" || undefined} aria-describedby={state.message ? "form-status" : undefined} /></div>
    <div className="field"><div className="label-row"><label htmlFor="password">Password</label><Link href="/forgot-password">Forgot password?</Link></div><input id="password" name="password" type="password" autoComplete="current-password" required minLength={12} aria-invalid={state.status === "error" || undefined} aria-describedby={state.message ? "form-status" : undefined} /></div>
    <div id="form-status" className={`form-status ${state.status}`} aria-live="polite">{state.message}</div>
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
  </form>;
}
