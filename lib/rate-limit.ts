import "server-only";

export type RecoveryRateLimitContext = {
  normalizedEmail: string;
};

export type BookmarkMcpRateLimitContext = {
  userId: string;
  authKind: "session" | "bearer";
};

export type ChatRateLimitContext = {
  userId: string;
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

/**
 * Extension point for a shared per-user chat/concurrency/token limiter.
 * This no-op is suitable only for local development.
 */
export async function checkChatRateLimit(
  context: ChatRateLimitContext,
): Promise<{ allowed: true }> {
  void context;
  return { allowed: true };
}
