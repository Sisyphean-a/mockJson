import test from "node:test";
import assert from "node:assert/strict";
import type { GlobalDelay } from "../../shared/types.js";
import { effectiveDelayMs } from "./global-delay.js";

const base: GlobalDelay = { mode: "off", fixedMs: 500, minMs: 200, maxMs: 800 };

test("关闭全局延迟时沿用场景延迟", () => {
  assert.equal(effectiveDelayMs(base, 25), 25);
  assert.equal(effectiveDelayMs(undefined, 25), 25);
});

test("固定延迟覆盖场景延迟", () => {
  assert.equal(effectiveDelayMs({ ...base, mode: "fixed", fixedMs: 750 }, 25), 750);
});

test("随机延迟在闭区间内取值", () => {
  const delay: GlobalDelay = { ...base, mode: "random", minMs: 100, maxMs: 200 };
  assert.equal(effectiveDelayMs(delay, 25, () => 0), 100);
  assert.equal(effectiveDelayMs(delay, 25, () => 0.5), 150);
  assert.equal(effectiveDelayMs(delay, 25, () => 0.999999), 200);
});
