"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "@/lib/auth-actions";
import { initialAuthActionState } from "@/lib/auth-state";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, initialAuthActionState);
  return <form action={action} className="auth-form">
    <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} aria-invalid={Boolean(state.errors?.email) || undefined} aria-describedby={state.errors?.email ? "email-error" : undefined} />{state.errors?.email ? <p id="email-error" className="field-error">{state.errors.email[0]}</p> : null}</div>
    <div className={`form-status ${state.status}`} aria-live="polite">{state.message}</div>
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
  </form>;
}
