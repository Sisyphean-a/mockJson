import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { createProxy, hasRequestBody } from "./proxy.js";
import { RequestLogStore } from "./request-logs.js";
import type { State } from "../../shared/types.js";

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
async function request(
  state: State,
  options: Record<string, unknown> = {},
  logs = new RequestLogStore(),
) {
  const app = Fastify();
  app.setNotFoundHandler((req, reply) => createProxy(req, reply, state, logs));
  const response = await app.inject({ method: "GET", url: "/api/chile/loan?case=failed", headers: { apiName: "loan-home" }, ...options } as any);
  await app.close();
  return response;
}

test("Fastify 收到请求头后可按 Header 规则命中场景", async () => {
  const response = await request(createState(matchingRules()));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { matched: true });
});

test("命中 Mock 会记录逻辑接口、场景和响应数据", async () => {
  const logs = new RequestLogStore();
  await request(createState(matchingRules()), {}, logs);

  const [log] = logs.list();
  assert.ok(log);
  assert.equal(log.outcome, "mocked");
  assert.equal(log.apiName, "测试接口");
  assert.equal(log.scenarioName, "命中");
  assert.deepEqual(JSON.parse(log.response.body || ""), { matched: true });
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

test("相同优先级按配置顺序命中第一个接口", async () => {
  const state = createState(matchingRules());
  state.packages[0].apis.push({
    id: "second",
    name: "第二接口",
    enabled: true,
    priority: state.packages[0].apis[0].priority,
    matchMode: "AND",
    matchRules: matchingRules(),
    activeScenarioId: "second-scene",
    scenarios: [{ id: "second-scene", name: "第二场景", status: 200, delayMs: 0, responseBody: { matched: "second" } }],
  });

  const response = await request(state);
  assert.deepEqual(response.json(), { matched: true });
});

test("接口移除后不会继续命中排序缓存", async () => {
  const state = createState(matchingRules());
  const first = await request(state);
  assert.equal(first.statusCode, 200);

  state.packages[0].apis.splice(0, 1);
  const second = await request(state);
  assert.equal(second.statusCode, 502);
});

test("响应日志按类型控制预览内存且不改变原始流", async () => {
  const binary = Buffer.alloc(64 * 1024, 0x5a);
  const text = Buffer.alloc(64 * 1024, 0x61);
  const compressed = gzipSync(Buffer.from(JSON.stringify({ ok: true })));
  const upstream = http.createServer((req, res) => {
    if (req.url === "/compressed") {
      res.setHeader("content-type", "application/json");
      res.setHeader("content-encoding", "gzip");
      return res.end(compressed);
    }
    if (req.url === "/text") {
      res.setHeader("content-type", "text/plain");
      return res.end(text);
    }
    res.setHeader("content-type", "application/octet-stream");
    return res.end(binary);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const state = createState([]);
  state.packages[0].apis[0].enabled = false;
  state.packages[0].targetBaseUrl = `http://127.0.0.1:${address.port}`;
  const logs = new RequestLogStore();

  const binaryResponse = await request(state, { url: "/binary" }, logs);
  const compressedResponse = await request(state, { url: "/compressed" }, logs);
  const textResponse = await request(state, { url: "/text" }, logs);
  await new Promise<void>((resolve) => upstream.close(() => resolve()));

  assert.deepEqual(binaryResponse.rawPayload, binary);
  assert.deepEqual(compressedResponse.rawPayload, compressed);
  assert.deepEqual(textResponse.rawPayload, text);
  const [textLog, compressedLog, binaryLog] = logs.list();
  assert.ok(textLog && compressedLog && binaryLog);
  assert.equal(textLog.response.body?.length, 32 * 1024);
  assert.equal(textLog.response.byteLength, text.length);
  assert.equal(textLog.response.truncated, true);
  assert.equal(compressedLog.response.body, null);
  assert.equal(compressedLog.response.byteLength, compressed.length);
  assert.equal(binaryLog.response.body, null);
  assert.equal(binaryLog.response.byteLength, binary.length);
});

test("多字节大响应的日志预览不会超过 UTF-8 字节上限", async () => {
  const state = createState(matchingRules());
  state.packages[0].apis[0].scenarios[0].responseBody = { text: "😀".repeat(20_000) };
  const logs = new RequestLogStore();
  const response = await request(state, {}, logs);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), state.packages[0].apis[0].scenarios[0].responseBody);
  const [log] = logs.list();
  assert.ok(log);
  assert.ok(log.response.body);
  assert.equal(log.response.truncated, true);
  assert.ok(Buffer.byteLength(log.response.body) <= 32 * 1024);
});

test("没有匹配规则时不处理请求", async () => {
  const logs = new RequestLogStore();
  const response = await request(createState([]), {}, logs);
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: "未命中 Mock，且当前 Package 未配置真实服务器" });

  const [log] = logs.list();
  assert.ok(log);
  assert.equal(log.outcome, "unmatched");
  assert.equal(log.apiName, null);
  assert.deepEqual(JSON.parse(log.response.body || ""), { error: "未命中 Mock，且当前 Package 未配置真实服务器" });
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

test("有请求体的代理在解析前直接流式转发", async () => {
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
  app.addContentTypeParser("*", { parseAs: "buffer" }, () => {
    throw new Error("请求体不应先被解析");
  });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-stream-test", "preserved");
    if (hasRequestBody(req)) await createProxy(req, reply, state, undefined, { streamRequestBody: true });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(500).send("未进入流式代理"));
  const payload = Buffer.alloc(128 * 1024, 0x61);
  const response = await app.inject({
    method: "POST",
    url: "/upload",
    headers: { "content-type": "application/octet-stream", "content-length": String(payload.length) },
    payload,
  });
  await app.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-stream-test"], "preserved");
  assert.deepEqual(received, payload);
});

test("客户端中断请求体时会释放上游请求", async () => {
  let upstreamAborted = false;
  let upstreamStartedResolve: (() => void) | undefined;
  let upstreamAbortedResolve: (() => void) | undefined;
  const upstreamStarted = new Promise<void>((resolve) => { upstreamStartedResolve = resolve; });
  const abortObserved = new Promise<void>((resolve) => { upstreamAbortedResolve = resolve; });
  const upstream = http.createServer((req) => {
    req.on("aborted", () => {
      upstreamAborted = true;
      upstreamAbortedResolve?.();
    });
    upstreamStartedResolve?.();
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const state = createState([]);
  state.packages[0].apis[0].enabled = false;
  state.packages[0].targetBaseUrl = `http://127.0.0.1:${address.port}`;
  const app = Fastify();
  app.addContentTypeParser("*", { parseAs: "buffer" }, () => {
    throw new Error("请求体不应先被解析");
  });
  app.addHook("onRequest", async (req, reply) => {
    if (hasRequestBody(req)) await createProxy(req, reply, state, undefined, { streamRequestBody: true });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(500).send("未进入流式代理"));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const appAddress = app.server.address();
  assert.ok(appAddress && typeof appAddress !== "string");
  let clientSocket: import("node:net").Socket | undefined;
  const client = http.request({
    hostname: "127.0.0.1",
    port: appAddress.port,
    path: "/abort",
    method: "POST",
    headers: { "content-length": "65536" },
  });
  client.on("socket", (socket) => { clientSocket = socket; });
  client.on("error", () => undefined);
  client.write("x");
  await upstreamStarted;
  client.destroy();
  clientSocket?.destroy();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000);
    abortObserved.then(() => { clearTimeout(timer); resolve(); });
  });
  await app.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));

  assert.equal(upstreamAborted, true);
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
  const logs = new RequestLogStore();
  const response = await request(state, { method: "POST", url: "/echo?x=1", headers: { "content-type": "application/json" }, payload: { hello: "world" } }, logs);
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  assert.equal(response.statusCode, 200);
  assert.equal(received.url, "/base/echo?x=1");
  assert.deepEqual(JSON.parse(received.body || ""), { hello: "world" });
  const [log] = logs.list();
  assert.ok(log);
  assert.equal(log.outcome, "forwarded");
  assert.deepEqual(JSON.parse(log.response.body || ""), { ok: true });
});
