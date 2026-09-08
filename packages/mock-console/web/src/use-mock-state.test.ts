import test from "node:test";
import assert from "node:assert/strict";
import { AdminTransportError, MockAdminClient, type AdminTransport } from "./mock-admin-client";
import { createRuntimeEndpoints } from "./runtime-endpoints";
import { useMockState } from "./use-mock-state";

const endpoints = createRuntimeEndpoints({ protocol: "http:", port: "22333" });

function clientReturning(response: () => Response) {
  const transport: AdminTransport = { send: async () => response() };
  return new MockAdminClient(endpoints, transport);
}

test("加载配置由状态层统一标记服务可用", async () => {
  const model = useMockState(clientReturning(() => new Response(JSON.stringify({ currentPackageId: null, packages: [] }), { status: 200 })));

  await model.load();

  assert.equal(model.serverReady.value, true);
  assert.equal(model.loading.value, false);
  assert.equal(model.loadError.value, "");
});

test("业务请求的传输失败由状态层统一标记服务不可用", async () => {
  const model = useMockState(clientReturning(() => new Response(null, { status: 204 })));
  model.serverReady.value = true;
  const error = new AdminTransportError("/__mock_admin/state", new TypeError("Failed to fetch"));

  await assert.rejects(model.runAdminRequest(() => Promise.reject(error)), error);

  assert.equal(model.serverReady.value, false);
});

test("普通编程错误不会被误判为服务断线", async () => {
  const model = useMockState(clientReturning(() => new Response(null, { status: 204 })));
  model.serverReady.value = true;
  const error = new TypeError("Illegal invocation");

  await assert.rejects(model.runAdminRequest(() => Promise.reject(error)), error);

  assert.equal(model.serverReady.value, true);
});

test("首次加载的 HTTP 错误进入唯一加载错误状态", async () => {
  const model = useMockState(clientReturning(() => new Response(null, { status: 503 })));

  await assert.rejects(model.load(), /管理服务返回 503/);

  assert.equal(model.serverReady.value, false);
  assert.equal(model.loading.value, false);
  assert.equal(model.loadError.value, "管理服务返回 503");
});
