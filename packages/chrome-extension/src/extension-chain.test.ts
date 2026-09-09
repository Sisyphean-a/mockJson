import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bridge = readFileSync(new URL("./content-bridge.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("./service-worker.ts", import.meta.url), "utf8");

test("bridge forwards cancellation and coalesces monitoring state refreshes", () => {
  assert.match(bridge, /type: "cancel"/);
  assert.match(bridge, /cancelledResolutions/);
  assert.match(bridge, /monitoringSync/);
  assert.match(bridge, /monitoring-state-request/);
});

test("service worker aborts cancelled resolver requests and protects concurrency", () => {
  assert.match(worker, /pendingResolvers = new Map/);
  assert.match(worker, /pendingResolvers\.get\(message\.id\)\?\.abort\(\)/);
  assert.match(worker, /MAX_RESOLVER_CONCURRENCY = 32/);
  assert.match(worker, /activeResolverCount >= MAX_RESOLVER_CONCURRENCY/);
  assert.match(worker, /timedOut/);
  assert.match(worker, /chrome\.storage\.session/);
  assert.match(worker, /loadResolverHealth/);
});
