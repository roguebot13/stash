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

export function PasswordResetEmail({ resetUrl }: { resetUrl: string }) {
  return (
    <html>
      <body style={body}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>Use this one-time link to reset your Stash password.</div>
        <main style={card}>
          <h1>Reset your Stash password</h1>
          <p>This link expires in 60 minutes and can be used once.</p>
          <p>
            <a href={resetUrl} style={button}>Reset password</a>
          </p>
          <p>If the button does not work, open this address:</p>
          <p><a href={resetUrl}>{resetUrl}</a></p>
          <p>If you did not request a password reset, you can ignore this email.</p>
        </main>
      </body>
    </html>
  );
}
