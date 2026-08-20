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

export function VerifyEmail({ verificationUrl }: { verificationUrl: string }) {
  return (
    <html>
      <body style={body}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>Verify your email before signing in to Stash.</div>
        <main style={card}>
          <h1>Verify your Stash email</h1>
          <p>Confirm this email address to activate your account and sign in.</p>
          <p>This link expires in 24 hours and can be used once.</p>
          <p>
            <a href={verificationUrl} style={button}>Verify email</a>
          </p>
          <p>If the button does not work, open this address:</p>
          <p><a href={verificationUrl}>{verificationUrl}</a></p>
          <p>If you did not create a Stash account, you can ignore this email.</p>
        </main>
      </body>
    </html>
  );
}
