import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type SafeUser = { id: string; email: string };

export async function getCurrentUser(): Promise<SafeUser | null> {
  const session = await auth();
  if (!session?.user.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, emailVerifiedAt: true, sessionVersion: true },
  });

  if (
    !user ||
    !user.emailVerifiedAt ||
    user.sessionVersion !== session.user.sessionVersion
  ) return null;
  return { id: user.id, email: user.email };
}

export async function requireUser(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireApiUser(): Promise<
  { ok: true; user: SafeUser } | { ok: false; response: Response }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, user };
}
