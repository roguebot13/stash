import type { Metadata } from "next";

import { Chat } from "@/app/chat/chat";
import { logoutAction } from "@/lib/auth-actions";
import { requireUser } from "@/lib/auth-dal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chat — Stash",
  description: "Chat with your private bookmark collection.",
};

export default async function Home() {
  const user = await requireUser();

  return (
    <Chat
      email={user.email}
      accountActions={
        <form action={logoutAction}>
          <button className="chat-header-button" type="submit">Sign out</button>
        </form>
      }
    />
  );
}
