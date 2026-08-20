import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="auth-page"><section className="auth-card">
      <Link className="brand" href="/" aria-label="Stash home">stash<span>.</span></Link>
      <header className="auth-heading"><h1>{title}</h1><p>{description}</p></header>
      {children}
      {footer ? <footer className="auth-footer">{footer}</footer> : null}
    </section></main>
  );
}
