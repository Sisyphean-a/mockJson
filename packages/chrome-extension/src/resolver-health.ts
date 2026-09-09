export const RESOLVER_FAILURE_THRESHOLD = 2;
export const RESOLVER_COOLDOWN_MS = 3000;

export type ResolverHealth = {
  failureStreak: number;
  unavailableUntil: number;
};

export function createResolverHealth(): ResolverHealth {
  return { failureStreak: 0, unavailableUntil: 0 };
}

export function isResolverCircuitOpen(health: ResolverHealth, now = Date.now()) {
  return health.unavailableUntil > now;
}

export function recordResolverSuccess(health: ResolverHealth) {
  health.failureStreak = 0;
  health.unavailableUntil = 0;
}

export function recordResolverFailure(health: ResolverHealth, now = Date.now()) {
  health.failureStreak += 1;
  if (health.failureStreak < RESOLVER_FAILURE_THRESHOLD) return;
  health.failureStreak = 0;
  health.unavailableUntil = now + RESOLVER_COOLDOWN_MS;
}
