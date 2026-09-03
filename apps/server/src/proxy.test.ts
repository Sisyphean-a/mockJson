import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createProxy } from "./proxy.js";
import type { State } from "./types.js";

function createState(
  rules: State["packages"][number]["apis"][number]["matchRules"],
): State {
  return {
    currentPackageId: "pkg",
    packages: [
      {
        id: "pkg",
        name: "测试包",
        targetBaseUrl: "",
        apis: [
          {
            id: "api",
            name: "测试接口",
            enabled: true,
            priority: 10,
            matchMode: "AND",
            matchRules: rules,
            activeScenarioId: "ok",
            scenarios: [
              {
                id: "ok",
                name: "命中",
                status: 200,
                delayMs: 0,
                responseBody: { matched: true },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function request(state: State) {
  const app = Fastify();
  app.setNotFoundHandler((req, reply) => createProxy(req, reply, state));
  const response = await app.inject({
    method: "GET",
    url: "/api/chile/loan?case=failed",
    headers: { apiName: "loan-home" },
  });
  await app.close();
  return response;
}

test("Fastify 收到请求头后可按 Header 规则命中场景", async () => {
  const response = await request(
    createState([
      {
        id: "header-rule",
        source: "header",
        field: "apiName",
        operator: "equals",
        value: "loan-home",
      },
    ]),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { matched: true });
});

test("代理返回 activeScenarioId 指向的场景", async () => {
  const state = createState([]);
  const api = state.packages[0].apis[0];
  api.scenarios.push({
    id: "second",
    name: "第二场景",
    status: 200,
    delayMs: 0,
    responseBody: { matched: "second" },
  });
  api.activeScenarioId = "second";

  const response = await request(state);

  assert.deepEqual(response.json(), { matched: "second" });
});

test("fullUrl 可使用查询参数匹配，path 只匹配路径", async () => {
  const response = await request(
    createState([
      {
        id: "url-rule",
        source: "url",
        field: "fullUrl",
        operator: "contains",
        value: "case=failed",
      },
    ]),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { matched: true });
});
