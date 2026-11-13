import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DETAIL_RATIO, clampDetailRatio, detailRatioFromPointer } from "./panel-split.js";

test("详情比例默认为 42%，并保留列表与详情的最小可用高度", () => {
  assert.equal(clampDetailRatio(DEFAULT_DETAIL_RATIO, 700), DEFAULT_DETAIL_RATIO);
  assert.equal(clampDetailRatio(0, 700), 180 / 700);
  assert.equal(clampDetailRatio(1, 700), 0.8);
  assert.equal(clampDetailRatio(Number.NaN, 700), DEFAULT_DETAIL_RATIO);
  assert.equal(clampDetailRatio(DEFAULT_DETAIL_RATIO, 0), DEFAULT_DETAIL_RATIO);
});

test("按分隔条指针位置换算详情高度占比", () => {
  const ratio = detailRatioFromPointer(500, 100, 700, 7);
  assert.ok(Math.abs(ratio - 296.5 / 700) < 1e-9);
  assert.equal(detailRatioFromPointer(0, 0, 0, 7), DEFAULT_DETAIL_RATIO);
});
