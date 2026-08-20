import "server-only";

export type RecoveryRateLimitContext = {
  normalizedEmail: string;
};

export type BookmarkMcpRateLimitContext = {
  userId: string;
  authKind: "session" | "bearer";
};

/**
 * Extension point for a shared IP/email limiter. The per-account database
 * cooldown is intentionally not represented as a multi-instance abuse limit.
 */
export async function checkRecoveryRateLimit(
  context: RecoveryRateLimitContext,
): Promise<{ allowed: true }> {
  void context;
  return { allowed: true };
}

/**
 * Extension point for a shared per-user MCP limiter. Deployment-specific IP
 * identity must be supplied only after defining a trusted proxy boundary.
 */
export async function checkBookmarkMcpRateLimit(
  context: BookmarkMcpRateLimitContext,
): Promise<{ allowed: true }> {
  void context;
  return { allowed: true };
}
