"use client";

import { useActionState } from "react";

import { verifyEmailAction } from "@/lib/auth-actions";
import { initialAuthActionState } from "@/lib/auth-state";

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(verifyEmailAction, initialAuthActionState);
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="token" value={token} />
      <div className={`form-status ${state.status}`} role={state.status === "error" ? "alert" : undefined} aria-live="polite">{state.message}</div>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Verifying…" : "Verify email"}
      </button>
    </form>
  );
}
