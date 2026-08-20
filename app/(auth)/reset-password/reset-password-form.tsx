"use client";

import { useActionState } from "react";
import { resetPasswordAction } from "@/lib/auth-actions";
import { initialAuthActionState } from "@/lib/auth-state";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialAuthActionState);
  return <form action={action} className="auth-form">
    <input type="hidden" name="token" value={token} />
    <div className="field"><label htmlFor="password">New password</label><input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} aria-invalid={Boolean(state.errors?.password) || undefined} aria-describedby={state.errors?.password ? "password-error" : undefined} />{state.errors?.password ? <p id="password-error" className="field-error">{state.errors.password[0]}</p> : <p className="field-hint">At least 12 characters, up to 72 bytes.</p>}</div>
    <div className="field"><label htmlFor="confirmPassword">Confirm new password</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} aria-invalid={Boolean(state.errors?.confirmPassword) || undefined} aria-describedby={state.errors?.confirmPassword ? "confirmPassword-error" : undefined} />{state.errors?.confirmPassword ? <p id="confirmPassword-error" className="field-error">{state.errors.confirmPassword[0]}</p> : null}</div>
    <div className={`form-status ${state.status}`} aria-live="polite">{state.message}</div>
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "Resetting password…" : "Reset password"}</button>
  </form>;
}
