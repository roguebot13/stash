"use client";

import { useActionState } from "react";
import { signupAction } from "@/lib/auth-actions";
import { initialAuthActionState } from "@/lib/auth-state";

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, initialAuthActionState);
  return <form action={action} className="auth-form">
    <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} aria-invalid={Boolean(state.errors?.email) || undefined} aria-describedby={state.errors?.email ? "email-error" : undefined} />{state.errors?.email ? <p id="email-error" className="field-error">{state.errors.email[0]}</p> : null}</div>
    <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} aria-invalid={Boolean(state.errors?.password) || undefined} aria-describedby={state.errors?.password ? "password-error" : undefined} />{state.errors?.password ? <p id="password-error" className="field-error">{state.errors.password[0]}</p> : <p className="field-hint">At least 12 characters, up to 72 bytes.</p>}</div>
    <div className="field"><label htmlFor="confirmPassword">Confirm password</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} aria-invalid={Boolean(state.errors?.confirmPassword) || undefined} aria-describedby={state.errors?.confirmPassword ? "confirmPassword-error" : undefined} />{state.errors?.confirmPassword ? <p id="confirmPassword-error" className="field-error">{state.errors.confirmPassword[0]}</p> : null}</div>
    <div className={`form-status ${state.status}`} aria-live="polite">{state.message}</div>
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
  </form>;
}
