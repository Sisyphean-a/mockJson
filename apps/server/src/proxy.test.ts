import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import http from "node:http";
import { createProxy } from "./proxy.js";
import type { State } from "./types.js";

const matchingRules = (): State["packages"][number]["apis"][number]["matchRules"] => [{
  id: "header-rule", source: "header", field: "apiName", operator: "equals", value: "loan-home",
}];

function createState(rules: State["packages"][number]["apis"][number]["matchRules"]): State {
  return {
    currentPackageId: "pkg",
    packages: [{ id: "pkg", name: "测试包", targetBaseUrl: "", apis: [{
      id: "api", name: "测试接口", enabled: true, priority: 10, matchMode: "AND", matchRules: rules,
      activeScenarioId: "ok", scenarios: [{ id: "ok", name: "命中", status: 200, delayMs: 0, responseBody: { matched: true } }],
    }] }],
  };
}
async function request(state: State, options: Record<string, unknown> = {}) {
  const app = Fastify();
  app.setNotFoundHandler((req, reply) => createProxy(req, reply, state));
  const response = await app.inject({ method: "GET", url: "/api/chile/loan?case=failed", headers: { apiName: "loan-home" }, ...options } as any);
  await app.close();
  return response;
}

test("Fastify 收到请求头后可按 Header 规则命中场景", async () => {
  const response = await request(createState(matchingRules()));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { matched: true });
});

test("代理返回 activeScenarioId 指向的场景", async () => {
  const state = createState(matchingRules());
  const api = state.packages[0].apis[0];
  api.scenarios.push({ id: "second", name: "第二场景", status: 200, delayMs: 0, responseBody: { matched: "second" } });
  api.activeScenarioId = "second";
  const response = await request(state);
  assert.deepEqual(response.json(), { matched: "second" });
});

test("fullUrl 可使用查询参数匹配", async () => {
  const response = await request(createState([{ id: "url-rule", source: "url", field: "fullUrl", operator: "contains", value: "case=failed" }]));
  assert.equal(response.statusCode, 200);
});

test("没有场景的高优先级接口不会遮挡可用 Mock", async () => {
  const state = createState(matchingRules());
  state.packages[0].apis.unshift({ id: "empty", name: "未完成接口", enabled: true, priority: 99, matchMode: "AND", matchRules: matchingRules(), activeScenarioId: null, scenarios: [] });
  const response = await request(state);
  assert.deepEqual(response.json(), { matched: true });
});

test("没有启用场景的高优先级接口不会遮挡可用 Mock", async () => {
  const state = createState(matchingRules());
  state.packages[0].apis.unshift({
    id: "inactive", name: "未启用场景的接口", enabled: true, priority: 99, matchMode: "AND",
    matchRules: matchingRules(), activeScenarioId: null,
    scenarios: [{ id: "draft", name: "未启用", status: 200, delayMs: 0, responseBody: { draft: true } }],
  });
  const response = await request(state);
  assert.deepEqual(response.json(), { matched: true });
});

test("没有匹配规则时不处理请求", async () => {
  const response = await request(createState([]));
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: "未命中 Mock，且当前 Package 未配置真实服务器" });
});

test("接口关闭时不处理请求", async () => {
  const state = createState(matchingRules());
  state.packages[0].apis[0].enabled = false;
  const response = await request(state);
  assert.equal(response.statusCode, 502);
});

test("活动场景失效时不回退到其他场景", async () => {
  const state = createState(matchingRules());
  state.packages[0].apis[0].activeScenarioId = "missing";
  const response = await request(state);
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: "未命中 Mock，且当前 Package 未配置真实服务器" });
});

test("未命中代理会保留 multipart 原始字节", async () => {
  let received = Buffer.alloc(0);
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => { received = Buffer.concat(chunks); res.end("ok"); });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const state = createState([]);
  state.packages[0].apis[0].enabled = false;
  state.packages[0].targetBaseUrl = `http://127.0.0.1:${address.port}`;
  const app = Fastify();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.setNotFoundHandler((req, reply) => createProxy(req, reply, state));
  const payload = Buffer.from("--boundary\r\ncontent\r\n--boundary--\r\n");
  const response = await app.inject({ method: "POST", url: "/upload", headers: { "content-type": "multipart/form-data; boundary=boundary" }, payload });
  await app.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, payload);
});

test("未命中代理会转发 JSON 请求体并保留目标基础路径", async () => {
  const received: { url?: string; body?: string } = {};
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      received.url = req.url;
      received.body = Buffer.concat(chunks).toString();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const state = createState([]);
  state.packages[0].apis[0].enabled = false;
  state.packages[0].targetBaseUrl = `http://127.0.0.1:${address.port}/base`;
  const response = await request(state, { method: "POST", url: "/echo?x=1", headers: { "content-type": "application/json" }, payload: { hello: "world" } });
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  assert.equal(response.statusCode, 200);
  assert.equal(received.url, "/base/echo?x=1");
  assert.deepEqual(JSON.parse(received.body || ""), { hello: "world" });
});
