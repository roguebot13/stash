import "server-only";

import { z } from "zod";

function configuredUrl(variableName: string, options?: { issuer?: boolean }) {
  return z.string().min(1).transform((value, context) => {
    if (value.trim() !== value) {
      context.addIssue({ code: "custom", message: `${variableName} must not contain surrounding whitespace` });
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: `${variableName} must be an absolute URL` });
      return z.NEVER;
    }

    const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && isLoopback)) {
      context.addIssue({ code: "custom", message: `${variableName} must use HTTPS` });
    }
    if (!options?.issuer && url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: `${variableName} must use HTTP or HTTPS` });
    }
    if (url.username || url.password || url.search || url.hash) {
      context.addIssue({ code: "custom", message: `${variableName} must not contain credentials, a query, or a fragment` });
    }
    if (!options?.issuer && url.pathname !== "/") {
      context.addIssue({ code: "custom", message: `${variableName} must be an origin without a path` });
    }

    return options?.issuer ? value : url.origin;
  });
}

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: configuredUrl("APP_URL"),
  MCP_AUTH_ISSUER: configuredUrl("MCP_AUTH_ISSUER", { issuer: true }),
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
    MCP_AUTH_ISSUER: process.env.MCP_AUTH_ISSUER,
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
