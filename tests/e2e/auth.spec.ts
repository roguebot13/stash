import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@/app/generated/prisma/client";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const isolated = Boolean(testDatabaseUrl && new URL(testDatabaseUrl).pathname.toLowerCase().includes("test"));
test.skip(!isolated, "Set TEST_DATABASE_URL to an isolated, migrated test database.");

test("sign-up, sign-out, sign-in, recovery confirmation, and one-time reset", async ({ page }) => {
  test.setTimeout(60_000);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl! }) });
  await db.emailVerificationToken.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.user.deleteMany();

  const email = `browser-${Date.now()}@example.com`;
  const originalPassword = "original password";
  const newPassword = "replacement password";

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(originalPassword);
  await page.getByLabel("Confirm password").fill(originalPassword);
  const invalidFields = await page.locator("form.auth-form").evaluate((element) =>
    Array.from((element as HTMLFormElement).elements)
      .filter((element): element is HTMLInputElement => element instanceof HTMLInputElement && !element.checkValidity())
      .map((element) => ({ name: element.name, message: element.validationMessage })),
  );
  expect(invalidFields).toEqual([]);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email\/pending/);
  await expect(page.getByText("Check your email to verify your account before signing in.")).toBeVisible();

  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.emailVerifiedAt).toBeNull();
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(originalPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();

  const verificationRaw = randomBytes(32).toString("base64url");
  const verificationHash = createHash("sha256").update(verificationRaw, "utf8").digest("hex");
  await db.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: verificationHash,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await page.goto(`/verify-email?token=${verificationRaw}`);
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByText("Your email has been verified. Sign in to continue.")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(originalPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3000/");
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await page.getByLabel("Password").fill(originalPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3000/");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("unknown@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If an account exists for that email, we sent a password reset link.")).toBeVisible();

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) } });
  await page.goto(`/reset-password?token=${rawToken}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Your password has been reset. Sign in with your new password.")).toBeVisible();
  await page.goto(`/reset-password?token=${rawToken}`);
  await expect(page.getByText("This reset link is invalid or has expired.")).toBeVisible();

  await db.$disconnect();
});
