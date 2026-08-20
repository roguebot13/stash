"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/auth";
import {
  forgotPasswordSchema,
  registrationSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  safeReturnTo,
  signInSchema,
  verifyEmailSchema,
} from "@/lib/auth-schemas";
import type { AuthActionState } from "@/lib/auth-state";
import {
  consumeEmailVerificationToken,
  consumeResetToken,
  createPendingCredentialsUser,
  GENERIC_VERIFICATION_REQUEST_MESSAGE,
  GENERIC_RESET_REQUEST_MESSAGE,
  INVALID_VERIFICATION_TOKEN_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
  invalidateEmailVerificationToken,
  isUniqueConstraintError,
  requestEmailVerification,
  requestPasswordReset,
} from "@/lib/auth-service";
import { sendVerificationEmail, sendWelcomeEmail } from "@/lib/mail";

const INVALID_LOGIN_MESSAGE = "Invalid email or password.";
const GENERIC_REGISTRATION_MESSAGE =
  "Unable to create an account with those details. Try signing in, resending verification, or resetting your password.";

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function loginAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const emailValue = formValue(formData, "email");
  const parsed = signInSchema.safeParse({ email: emailValue, password: formValue(formData, "password") });
  if (!parsed.success) return { status: "error", message: INVALID_LOGIN_MESSAGE, values: { email: emailValue } };
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeReturnTo(formValue(formData, "returnTo")),
    });
  } catch (error) {
    if (error instanceof AuthError) return { status: "error", message: INVALID_LOGIN_MESSAGE, values: { email: emailValue } };
    throw error;
  }
  return { status: "error", message: INVALID_LOGIN_MESSAGE, values: { email: emailValue } };
}

export async function signupAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const emailValue = formValue(formData, "email");
  const parsed = registrationSchema.safeParse({
    email: emailValue,
    password: formValue(formData, "password"),
    confirmPassword: formValue(formData, "confirmPassword"),
  });
  if (!parsed.success) return { status: "error", values: { email: emailValue }, errors: parsed.error.flatten().fieldErrors };

  let registration: {
    user: { id: string; email: string };
    tokenId: string;
    rawToken: string;
  };
  try {
    registration = await createPendingCredentialsUser(parsed.data.email, parsed.data.password);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      console.info(JSON.stringify({ event: "registration.failed", category: "duplicate_or_invalid" }));
      return { status: "error", message: GENERIC_REGISTRATION_MESSAGE, values: { email: emailValue } };
    }
    console.error(JSON.stringify({ event: "registration.failed", category: "internal" }));
    return { status: "error", message: "We could not create your account. Please try again.", values: { email: emailValue } };
  }

  console.info(JSON.stringify({ event: "registration.succeeded", userId: registration.user.id }));
  try {
    await sendVerificationEmail(
      registration.user.email,
      registration.rawToken,
      registration.tokenId,
    );
  } catch {
    try {
      await invalidateEmailVerificationToken(registration.tokenId);
    } catch {
      console.error(
        JSON.stringify({
          event: "email_verification.token_invalidation_failed",
          category: "internal",
          tokenId: registration.tokenId,
        }),
      );
    }
    return {
      status: "error",
      message:
        "Your account was created, but we could not send the verification email. Request a new link to continue.",
    };
  }
  console.info(
    JSON.stringify({
      event: "email_verification.issued",
      userId: registration.user.id,
      tokenId: registration.tokenId,
    }),
  );
  redirect("/verify-email/pending");
}

export async function resendVerificationAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const emailValue = formValue(formData, "email");
  const parsed = resendVerificationSchema.safeParse({ email: emailValue });
  if (!parsed.success) {
    return {
      status: "error",
      values: { email: emailValue },
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  try {
    await requestEmailVerification(parsed.data.email);
  } catch {
    console.error(
      JSON.stringify({ event: "email_verification.request_failed", category: "internal" }),
    );
  }
  return { status: "success", message: GENERIC_VERIFICATION_REQUEST_MESSAGE };
}

export async function verifyEmailAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = verifyEmailSchema.safeParse({ token: formValue(formData, "token") });
  if (!parsed.success) return { status: "error", message: INVALID_VERIFICATION_TOKEN_MESSAGE };

  let user: { id: string; email: string } | null;
  try {
    user = await consumeEmailVerificationToken(parsed.data.token);
  } catch {
    console.error(JSON.stringify({ event: "email_verification.failed", category: "internal" }));
    return { status: "error", message: "We could not verify your email. Please try again." };
  }
  if (!user) {
    console.info(
      JSON.stringify({
        event: "email_verification.token_rejected",
        category: "invalid_or_expired",
      }),
    );
    return { status: "error", message: INVALID_VERIFICATION_TOKEN_MESSAGE };
  }

  console.info(JSON.stringify({ event: "email_verification.succeeded", userId: user.id }));
  try {
    await sendWelcomeEmail(user.email, user.id);
  } catch {
    // Welcome delivery is best effort and the mail helper logs a sanitized error.
  }
  redirect("/login?verified=success");
}

export async function forgotPasswordAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const emailValue = formValue(formData, "email");
  const parsed = forgotPasswordSchema.safeParse({ email: emailValue });
  if (!parsed.success) return { status: "error", values: { email: emailValue }, errors: parsed.error.flatten().fieldErrors };
  try { await requestPasswordReset(parsed.data.email); } catch {
    console.error(JSON.stringify({ event: "password_reset.request_failed", category: "internal" }));
  }
  return { status: "success", message: GENERIC_RESET_REQUEST_MESSAGE };
}

export async function resetPasswordAction(_previous: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formValue(formData, "token"),
    password: formValue(formData, "password"),
    confirmPassword: formValue(formData, "confirmPassword"),
  });
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    if (errors.token) return { status: "error", message: INVALID_RESET_TOKEN_MESSAGE };
    return { status: "error", errors };
  }
  try {
    if (!(await consumeResetToken(parsed.data.token, parsed.data.password))) return { status: "error", message: INVALID_RESET_TOKEN_MESSAGE };
  } catch {
    console.error(JSON.stringify({ event: "password_reset.failed", category: "internal" }));
    return { status: "error", message: "We could not reset your password. Please try again." };
  }
  redirect("/login?reset=success");
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
