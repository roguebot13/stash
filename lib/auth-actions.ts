"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/auth";
import {
  forgotPasswordSchema,
  registrationSchema,
  resetPasswordSchema,
  safeReturnTo,
  signInSchema,
} from "@/lib/auth-schemas";
import type { AuthActionState } from "@/lib/auth-state";
import {
  consumeResetToken,
  createCredentialsUser,
  GENERIC_RESET_REQUEST_MESSAGE,
  INVALID_RESET_TOKEN_MESSAGE,
  isUniqueConstraintError,
  requestPasswordReset,
} from "@/lib/auth-service";
import { sendWelcomeEmail } from "@/lib/mail";

const INVALID_LOGIN_MESSAGE = "Invalid email or password.";
const GENERIC_REGISTRATION_MESSAGE =
  "Unable to create an account with those details. Try signing in or resetting your password.";

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

  let user: { id: string; email: string };
  try {
    user = await createCredentialsUser(parsed.data.email, parsed.data.password);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      console.info(JSON.stringify({ event: "registration.failed", category: "duplicate_or_invalid" }));
      return { status: "error", message: GENERIC_REGISTRATION_MESSAGE, values: { email: emailValue } };
    }
    console.error(JSON.stringify({ event: "registration.failed", category: "internal" }));
    return { status: "error", message: "We could not create your account. Please try again.", values: { email: emailValue } };
  }

  console.info(JSON.stringify({ event: "registration.succeeded", userId: user.id }));
  try { await sendWelcomeEmail(user.email, user.id); } catch { /* best effort; helper logs safely */ }
  try {
    await signIn("credentials", { email: parsed.data.email, password: parsed.data.password, redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) return { status: "error", message: "Your account was created. Sign in to continue.", values: { email: emailValue } };
    throw error;
  }
  return { status: "success" };
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
