import { defineConfig, devices } from "@playwright/test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: testDatabaseUrl ? {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testDatabaseUrl,
      RESEND_API_KEY: "re_test",
      AUTH_SECRET: "x".repeat(64),
      APP_URL: "http://127.0.0.1:3000",
      EMAIL_FROM: "Stash <test@example.com>",
      AUTH_TEST_MAIL_MODE: "disabled",
    },
  } : undefined,
});
