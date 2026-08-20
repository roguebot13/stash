import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { getServerEnv } from "@/lib/env";
import { performDummyPasswordCheck, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { signInSchema } from "@/lib/auth-schemas";

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const env = getServerEnv();

  return {
    secret: env.AUTH_SECRET,
    trustHost: true,
    session: {
      strategy: "jwt",
      maxAge: 7 * 24 * 60 * 60,
    },
    pages: { signIn: "/login" },
    logger: {
      error(error) {
        console.error(
          JSON.stringify({ event: "auth.error", category: error.name || "unknown" }),
        );
      },
      warn(code) {
        console.warn(JSON.stringify({ event: "auth.warning", category: code }));
      },
      debug() {},
    },
    providers: [
      Credentials({
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          const parsed = signInSchema.safeParse(credentials);
          if (!parsed.success) {
            await performDummyPasswordCheck("");
            console.info(JSON.stringify({ event: "sign_in.failed", category: "invalid_credentials" }));
            return null;
          }

          const user = await prisma.user.findUnique({
            where: { email: parsed.data.email },
            select: {
              id: true,
              passwordHash: true,
              emailVerifiedAt: true,
              sessionVersion: true,
            },
          });

          if (!user) {
            await performDummyPasswordCheck(parsed.data.password);
            console.info(JSON.stringify({ event: "sign_in.failed", category: "invalid_credentials" }));
            return null;
          }

          if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
            console.info(JSON.stringify({ event: "sign_in.failed", category: "invalid_credentials" }));
            return null;
          }

          if (!user.emailVerifiedAt) {
            console.info(JSON.stringify({ event: "sign_in.failed", category: "inactive_account" }));
            return null;
          }

          console.info(JSON.stringify({ event: "sign_in.succeeded", userId: user.id }));
          return { id: user.id, sessionVersion: user.sessionVersion };
        },
      }),
    ],
    callbacks: {
      jwt({ token, user }) {
        if (user) {
          token.sub = user.id;
          token.sessionVersion = user.sessionVersion;
        }
        delete token.email;
        delete token.name;
        delete token.picture;
        return token;
      },
      session({ session, token }) {
        session.user.id = token.sub ?? "";
        session.user.sessionVersion =
          typeof token.sessionVersion === "number" ? token.sessionVersion : -1;
        Reflect.deleteProperty(session.user, "email");
        Reflect.deleteProperty(session.user, "name");
        Reflect.deleteProperty(session.user, "image");
        return session;
      },
    },
  };
});
