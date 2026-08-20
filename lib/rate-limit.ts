import "server-only";

export type RecoveryRateLimitContext = {
  normalizedEmail: string;
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
