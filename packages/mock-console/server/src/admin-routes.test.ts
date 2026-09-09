import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { MockConfigService, type StateRepository } from "./config-service.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { RequestLogStore } from "./request-logs.js";
import type { RequestLog, State } from "../../shared/types.js";

class MemoryRepository implements StateRepository {
  async read(): Promise<State> {
    return { currentPackageId: null, packages: [] };
  }

  async write(): Promise<void> {}
}

function logEntry(): Omit<RequestLog, "id"> {
  return {
    source: "proxy",
    timestamp: "2026-09-04T00:00:00.000Z",
    durationMs: 2,
    packageId: null,
    packageName: null,
    method: "GET",
    host: "127.0.0.1:22333",
    url: "/health",
    outcome: "unmatched",
    apiId: null,
    apiName: null,
    scenarioId: null,
    scenarioName: null,
    status: 502,
    response: { contentType: "application/json", body: "{}", byteLength: 2, truncated: false },
  };
}

test("管理 API 可以持久化接口和场景排序", async () => {
  const service = new MockConfigService(new MemoryRepository());
  await service.initialize();
  const packageConfig = await service.createPackage({ name: "测试包" });
  const firstApi = await service.createApi(packageConfig.id, { name: "第一个" });
  const secondApi = await service.createApi(packageConfig.id, { name: "第二个" });
  const firstScene = await service.createScenario(firstApi.id, { name: "第一个场景", responseBody: {} });
  const secondScene = await service.createScenario(firstApi.id, { name: "第二个场景", responseBody: {} });
  const logs = new RequestLogStore();
  const app = Fastify();
  registerAdminRoutes(app, service, logs);

  const apiOrder = await app.inject({
    method: "PUT",
    url: `/__mock_admin/packages/${packageConfig.id}/apis/order`,
    payload: { ids: [secondApi.id, firstApi.id] },
  });
  const scenarioOrder = await app.inject({
    method: "PUT",
    url: `/__mock_admin/apis/${firstApi.id}/scenarios/order`,
    payload: { ids: [secondScene.id, firstScene.id] },
  });

  assert.equal(apiOrder.statusCode, 200);
  assert.deepEqual(apiOrder.json().map((item: { id: string }) => item.id), [secondApi.id, firstApi.id]);
  assert.equal(scenarioOrder.statusCode, 200);
  assert.deepEqual(scenarioOrder.json().map((item: { id: string }) => item.id), [secondScene.id, firstScene.id]);
  await app.close();
});

test("管理 API 可以新增、切换和删除真实服务", async () => {
  const service = new MockConfigService(new MemoryRepository());
  await service.initialize();
  const packageConfig = await service.createPackage({ name: "测试包" });
  const logs = new RequestLogStore();
  const app = Fastify();
  registerAdminRoutes(app, service, logs);

  const created = await app.inject({
    method: "POST",
    url: `/__mock_admin/packages/${packageConfig.id}/real-services`,
    payload: { name: "测试环境", baseUrl: "https://test.example.com" },
  });
  assert.equal(created.statusCode, 201);
  const serviceId = created.json().id;

  const switched = await app.inject({
    method: "POST",
    url: `/__mock_admin/packages/${packageConfig.id}/active-real-service/${serviceId}`,
  });
  assert.deepEqual(switched.json(), { success: true, activeRealServiceId: serviceId });

  const deleted = await app.inject({ method: "DELETE", url: `/__mock_admin/real-services/${serviceId}` });
  assert.deepEqual(deleted.json(), { success: true, activeRealServiceId: null });
  await app.close();
});

test("管理 API 可以读取和清空运行态请求日志", async () => {
  const service = new MockConfigService(new MemoryRepository());
  await service.initialize();
  const logs = new RequestLogStore();
  logs.record(logEntry());
  const app = Fastify();
  registerAdminRoutes(app, service, logs);

  const list = await app.inject({ method: "GET", url: "/__mock_admin/logs" });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().logs.length, 1);
  const etag = list.headers.etag;
  assert.ok(etag);

  const unchanged = await app.inject({
    method: "GET",
    url: "/__mock_admin/logs",
    headers: { "if-none-match": etag },
  });
  assert.equal(unchanged.statusCode, 304);
  assert.equal(unchanged.rawPayload.length, 0);

  logs.record(logEntry());
  const changed = await app.inject({
    method: "GET",
    url: "/__mock_admin/logs",
    headers: { "if-none-match": etag },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().logs.length, 2);
  const changedEtag = changed.headers.etag;
  assert.ok(changedEtag);

  logs.record(logEntry());
  const delta = await app.inject({
    method: "GET",
    url: `/__mock_admin/logs?since=${encodeURIComponent(changedEtag)}`,
    headers: { "if-none-match": changedEtag },
  });
  assert.equal(delta.statusCode, 200);
  const deltaBody = delta.json();
  assert.equal(deltaBody.reset, false);
  assert.equal(deltaBody.logs.length, 1);
  assert.equal(deltaBody.logs[0].url, "/health");

  const clear = await app.inject({ method: "DELETE", url: "/__mock_admin/logs" });
  assert.equal(clear.statusCode, 200);
  assert.deepEqual(clear.json(), { success: true });

  const empty = await app.inject({ method: "GET", url: "/__mock_admin/logs" });
  assert.deepEqual(empty.json(), { logs: [] });
  await app.close();
});
