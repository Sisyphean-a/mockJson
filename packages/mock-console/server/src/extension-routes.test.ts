import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { MockConfigService, type StateRepository } from "./config-service.js";
import { registerExtensionRoutes } from "./extension-routes.js";
import { RequestLogStore } from "./request-logs.js";
import type { State } from "../../shared/types.js";

class MemoryRepository implements StateRepository {
  async read(): Promise<State> {
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
          priority: 1,
          matchMode: "AND",
          matchRules: [{ id: "path", source: "url", field: "path", operator: "equals", value: "/mocked" }],
          activeScenarioId: "scene",
          scenarios: [{ id: "scene", name: "成功", status: 200, delayMs: 0, responseBody: { mocked: true } }],
        }],
      }],
    };
  }

  async write(): Promise<void> {}
}

async function createApp() {
  const service = new MockConfigService(new MemoryRepository());
  await service.initialize();
  const app = Fastify();
  const logs = new RequestLogStore();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  registerExtensionRoutes(app, service, logs);
  return { app, logs };
}

test("扩展状态接口只返回连接和 Package 状态", async () => {
  const { app } = await createApp();
  const response = await app.inject({ method: "GET", url: "/__mock_extension/status" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { online: true, hasPackage: true });
  await app.close();
});

test("扩展判定接口返回 Mock 决定", async () => {
  const { app } = await createApp();
  const response = await app.inject({
    method: "POST",
    url: "/__mock_extension/resolve",
    payload: {
      url: "https://api.example.com/mocked?x=1",
      method: "GET",
      headers: {},
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    action: "mock",
    status: 200,
    delayMs: 0,
    body: JSON.stringify({ mocked: true }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  await app.close();
});

test("扩展判定日志标记来源和命中结果", async () => {
  const { app, logs } = await createApp();
  await app.inject({
    method: "POST",
    url: "/__mock_extension/resolve",
    payload: {
      url: "https://api.example.com/mocked?x=1",
      method: "GET",
      headers: {},
    },
  });
  await app.inject({
    method: "POST",
    url: "/__mock_extension/resolve",
    payload: {
      url: "https://api.example.com/real",
      method: "GET",
      headers: {},
    },
  });

  const [unmatched, mocked] = logs.list();
  assert.equal(unmatched.source, "extension");
  assert.equal(unmatched.outcome, "unmatched");
  assert.equal(unmatched.passReason, "unmatched");
  assert.equal(unmatched.status, 0);
  assert.equal(unmatched.host, "api.example.com");
  assert.equal(mocked.source, "extension");
  assert.equal(mocked.outcome, "mocked");
  assert.equal(mocked.apiName, "测试接口");
  assert.equal(mocked.scenarioName, "成功");
  assert.equal(mocked.status, 200);
  await app.close();
});

test("扩展判定接口未命中时返回放行决定", async () => {
  const { app } = await createApp();
  const response = await app.inject({
    method: "POST",
    url: "/__mock_extension/resolve",
    payload: {
      url: "https://api.example.com/real",
      method: "GET",
      headers: {},
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { action: "pass", reason: "unmatched" });
  await app.close();
});

test("扩展判定接口拒绝相对 URL 和无效 Headers", async () => {
  const { app } = await createApp();
  const relative = await app.inject({
    method: "POST",
    url: "/__mock_extension/resolve",
    payload: { url: "/mocked", method: "GET", headers: {} },
  });
  const invalidHeaders = await app.inject({
    method: "POST",
    url: "/__mock_extension/resolve",
    payload: { url: "https://api.example.com/mocked", method: "GET", headers: [] },
  });

  assert.equal(relative.statusCode, 400);
  assert.equal(invalidHeaders.statusCode, 400);
  await app.close();
});
