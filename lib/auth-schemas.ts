import { z } from "zod";

import { passwordByteLength } from "@/lib/password";
import { EMAIL_VERIFICATION_TOKEN_PATTERN } from "@/lib/email-verification-token";
import { RESET_TOKEN_PATTERN } from "@/lib/reset-token";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const emailSchema = z
  .string({ error: "Enter a valid email address." })
  .transform(normalizeEmail)
  .pipe(
    z
      .email({ error: "Enter a valid email address." })
      .max(320, { error: "Enter a valid email address." }),
  );

const passwordSchema = z
  .string({ error: "Enter a password." })
  .min(12, { error: "Password must be at least 12 characters." })
  .refine((password) => passwordByteLength(password) <= 72, {
    message: "Password must be no more than 72 bytes.",
  });

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const registrationSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ error: "Confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resendVerificationSchema = z.object({ email: emailSchema });

export const verifyEmailSchema = z.object({
  token: z.string().regex(EMAIL_VERIFICATION_TOKEN_PATTERN),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().regex(RESET_TOKEN_PATTERN),
    password: passwordSchema,
    confirmPassword: z.string({ error: "Confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

export function safeReturnTo(value: unknown) {
  if (typeof value !== "string") return "/";
  return /^\/(?!\/)/.test(value) ? value : "/";
}
