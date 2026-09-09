import test from "node:test";
import assert from "node:assert/strict";
import {
  RESOLVER_COOLDOWN_MS,
  RESOLVER_FAILURE_THRESHOLD,
  createResolverHealth,
  isResolverCircuitOpen,
  recordResolverFailure,
  recordResolverSuccess,
} from "./resolver-health.js";

test("resolver circuit opens only after consecutive failures", () => {
  const health = createResolverHealth();
  const now = 10_000;

  assert.equal(isResolverCircuitOpen(health, now), false);
  recordResolverFailure(health, now);
  assert.equal(isResolverCircuitOpen(health, now), false);
  recordResolverFailure(health, now);
  assert.equal(RESOLVER_FAILURE_THRESHOLD, 2);
  assert.equal(isResolverCircuitOpen(health, now), true);
  assert.equal(isResolverCircuitOpen(health, now + RESOLVER_COOLDOWN_MS), false);
});

test("a successful resolver response resets the circuit", () => {
  const health = createResolverHealth();
  recordResolverFailure(health, 10_000);
  recordResolverFailure(health, 10_000);
  recordResolverSuccess(health);

  assert.equal(isResolverCircuitOpen(health, 10_000), false);
  recordResolverFailure(health, 10_000);
  assert.equal(isResolverCircuitOpen(health, 10_000), false);
});
