import { logoutAction } from "@/lib/auth-actions";
import { requireUser } from "@/lib/auth-dal";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  return <main className="app-page">
    <nav className="app-nav"><div className="brand">stash<span>.</span></div><form action={logoutAction}><button className="secondary-button" type="submit">Sign out</button></form></nav>
    <section className="empty-state"><div className="eyebrow">Your collection</div><h1>A quieter place for the web.</h1><p>You’re signed in as <strong>{user.email}</strong>. Bookmark tools are coming next; authentication is ready.</p></section>
  </main>;
}
