import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z
    .url()
    .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
      message: "must use http or https",
    })
    .transform((value) => value.replace(/\/$/, "")),
  EMAIL_FROM: z.string().min(3),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv;

  const result = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_URL: process.env.APP_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });

  if (!result.success) {
    const names = Object.keys(result.error.flatten().fieldErrors).join(", ");
    throw new Error(`Invalid or missing server environment variable(s): ${names}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function resetEnvCacheForTests() {
  if (process.env.NODE_ENV === "test") cachedEnv = undefined;
}
