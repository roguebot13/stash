import type { CSSProperties } from "react";

const body: CSSProperties = {
  backgroundColor: "#f7f5f0",
  color: "#24231f",
  fontFamily: "Arial, Helvetica, sans-serif",
  margin: 0,
  padding: "32px 16px",
};

const card: CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e0d7",
  borderRadius: 16,
  margin: "0 auto",
  maxWidth: 560,
  padding: 32,
};

const button: CSSProperties = {
  backgroundColor: "#24231f",
  borderRadius: 8,
  color: "#ffffff",
  display: "inline-block",
  fontWeight: 700,
  padding: "12px 18px",
  textDecoration: "none",
};

export function WelcomeEmail({ appUrl }: { appUrl: string }) {
  return (
    <html>
      <body style={body}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>Welcome to Stash—your bookmarks now have a home.</div>
        <main style={card}>
          <h1>Welcome to Stash</h1>
          <p>Stash gives you one calm place to save and manage the bookmarks you want to keep.</p>
          <p>
            <a href={appUrl} style={button}>Open Stash</a>
          </p>
          <p>If the button does not work, open this address:</p>
          <p><a href={appUrl}>{appUrl}</a></p>
        </main>
      </body>
    </html>
  );
}
