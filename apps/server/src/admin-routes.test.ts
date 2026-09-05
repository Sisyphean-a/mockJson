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

  const clear = await app.inject({ method: "DELETE", url: "/__mock_admin/logs" });
  assert.equal(clear.statusCode, 200);
  assert.deepEqual(clear.json(), { success: true });

  const empty = await app.inject({ method: "GET", url: "/__mock_admin/logs" });
  assert.deepEqual(empty.json(), { logs: [] });
  await app.close();
});
