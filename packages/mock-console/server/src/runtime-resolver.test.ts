import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionRuntimeRequest, State } from "../../shared/types.js";
import { resolveExtensionRequest } from "./runtime-resolver.js";

const request: ExtensionRuntimeRequest = {
  url: "https://api.example.com/v1/loan?case=failed",
  method: "GET",
  headers: { "x-api-name": "loan-home" },
};

function createState(): State {
  return {
    currentPackageId: "pkg",
    packages: [{
      id: "pkg",
      name: "测试包",
      targetBaseUrl: "https://real.example.com",
      apis: [{
        id: "api",
        name: "测试接口",
        enabled: true,
        priority: 10,
        matchMode: "AND",
        matchRules: [{ id: "header", source: "header", field: "x-api-name", operator: "equals", value: "loan-home" }],
        activeScenarioId: "ok",
        scenarios: [{ id: "ok", name: "命中", status: 201, delayMs: 25, responseBody: { matched: true } }],
      }],
    }],
  };
}

test("扩展判定复用当前接口和场景", () => {
  assert.deepEqual(resolveExtensionRequest(createState(), request), {
    action: "mock",
    status: 201,
    delayMs: 25,
    body: JSON.stringify({ matched: true }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
});

test("扩展未命中时只返回放行，不使用 targetBaseUrl", () => {
  const state = createState();
  state.packages[0].apis[0].matchRules[0].value = "other";
  assert.deepEqual(resolveExtensionRequest(state, request), { action: "pass", reason: "unmatched" });
});

test("扩展不会命中关闭的接口或失效场景", () => {
  const state = createState();
  state.packages[0].apis[0].enabled = false;
  assert.deepEqual(resolveExtensionRequest(state, request), { action: "pass", reason: "unmatched" });

  state.packages[0].apis[0].enabled = true;
  state.packages[0].apis[0].activeScenarioId = "missing";
  assert.deepEqual(resolveExtensionRequest(state, request), { action: "pass", reason: "unmatched" });
});

test("扩展模式对 1xx 场景显式放行", () => {
  const state = createState();
  state.packages[0].apis[0].scenarios[0].status = 101;
  assert.deepEqual(resolveExtensionRequest(state, request), { action: "pass", reason: "unsupported-status" });
});
