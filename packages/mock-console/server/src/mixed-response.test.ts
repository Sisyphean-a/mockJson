import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { gzipSync } from "node:zlib";
import Fastify from "fastify";
import { composeResponse, validateMockFields } from "@mock-json/extension-contract/response-fields";
import type { ScenarioResponseType } from "@mock-json/extension-contract";
import type { State } from "../../shared/types.js";
import { MockConfigService } from "./config-service.js";
import { isValidState } from "./validation.js";
import { resolveExtensionRequest } from "./runtime-resolver.js";
import { createProxy, hasRequestBody } from "./proxy.js";
import { RequestLogStore } from "./request-logs.js";

const mock = { data: { name: "Mock", imageUrl: "expired", status: "APPROVED" } };
const real = { data: { name: "Real", imageUrl: "fresh-signed-url", status: "PENDING", extra: 1 } };
function state(type?: ScenarioResponseType, fieldPaths = ["/data/imageUrl"]): State {
  return { currentPackageId: "pkg", packages: [{ id: "pkg", name: "测试包", realServices: [], activeRealServiceId: null,
    apis: [{ id: "api", name: "接口", enabled: true, priority: 0, matchMode: "AND",
      matchRules: [{ id: "r", source: "url", field: "path", operator: "equals", value: "/api" }], activeScenarioId: "s",
      scenarios: [{ id: "s", name: "场景", status: 201, delayMs: 0, responseBody: structuredClone(mock), ...(type ? { responseType: type, fieldPaths } : {}) }] }] }] };
}

test("两种字段组合保持来源、未选字段和输入数据不变", () => {
  assert.deepEqual(composeResponse("real-overrides", mock, real, ["/data/status"]), { data: { ...real.data, status: "APPROVED" } });
  assert.deepEqual(composeResponse("mock-with-real", mock, real, ["/data/imageUrl"]), { data: { ...mock.data, imageUrl: "fresh-signed-url" } });
  assert.equal(mock.data.imageUrl, "expired");
  assert.equal(real.data.status, "PENDING");
  assert.deepEqual(composeResponse("real-overrides", { x: null, a: [false] }, { x: 1, a: [true] }, ["/x", "/a/0"]), { x: null, a: [false] });
});

test("JSON Pointer 转义、自有特殊键和明确数组下标，不污染原型", () => {
  const special = JSON.parse('{"a/b":{"~key":false},"__proto__":{"polluted":true}}');
  const base = JSON.parse('{"a/b":{"~key":true},"__proto__":null}');
  const result = composeResponse("real-overrides", special, base, ["/a~1b/~0key", "/__proto__"]);
  assert.deepEqual(result, special);
  assert.equal(({} as any).polluted, undefined);
  for (const fields of [["data/url"], ["/a~2b"], ["/data", "/data/imageUrl"], ["/data", "/data"], []])
    assert.throws(() => validateMockFields("mock-with-real", fields, mock));
  assert.throws(() => composeResponse("mock-with-real", mock, {}, ["/data/imageUrl"]), /字段不存在/);
  assert.throws(() => composeResponse("real-overrides", { a: [1, 2] }, { a: [0] }, ["/a/1"]), /结构不匹配/);
  assert.throws(() => composeResponse("mock-with-real", { data: null }, real, ["/data/imageUrl"]), /结构不匹配/);
});

test("场景类型持久化往返、旧配置兼容和拒绝无效配置后恢复", async () => {
  let saved = state();
  const service = new MockConfigService({ async read() { return structuredClone(saved); }, async write(value) { saved = structuredClone(value); } });
  await service.initialize();
  assert.equal(isValidState(saved), true);
  const mixed = await service.createScenario("api", { name: "真实底", responseType: "real-overrides", fieldPaths: ["/data/status"], responseBody: mock });
  await service.updateScenario(mixed.id, { responseType: "mock-with-real", fieldPaths: ["/data/imageUrl"] });
  const reloaded = new MockConfigService({ async read() { return saved; }, async write() {} });
  await reloaded.initialize();
  assert.equal(reloaded.getState().packages[0].apis[0].scenarios[1].responseType, "mock-with-real");
  for (const invalid of [{ responseType: "unknown" }, { responseType: null }, { fieldPaths: null }, { fieldPaths: [] }, { status: 204 }, { responseBody: {} }]) {
    await assert.rejects(() => service.updateScenario(mixed.id, invalid));
    assert.equal(isValidState(service.getState()), true);
    assert.equal(service.getState().packages[0].apis[0].scenarios[1].responseType, "mock-with-real");
  }
  const broken = structuredClone(saved);
  broken.packages[0].apis[0].scenarios[1].fieldPaths = ["data/url"];
  assert.equal(isValidState(broken), false);
});

test("resolver 在固定响应和条件分支下均返回混合指令，不在服务端重放请求", () => {
  for (const type of ["real-overrides", "mock-with-real"] as const) {
    const value = state(type);
    const request = { url: "https://business.test/api", method: "GET", headers: {} };
    assert.equal(resolveExtensionRequest(value, request).action, "transform");
    value.packages[0].apis[0].responseSelection = { mode: "conditional", branches: [], fallback: { enabled: true, scenarioId: "s" } };
    assert.equal(resolveExtensionRequest(value, request).action, "transform");
  }
});

async function proxyRequest(value: State, stream = false, payload?: string) {
  const logs = new RequestLogStore();
  const app = Fastify();
  if (stream) app.addHook("onRequest", async (req, reply) => {
    if (hasRequestBody(req)) await createProxy(req, reply, value, logs, { streamRequestBody: true });
  });
  app.setNotFoundHandler((req, reply) => createProxy(req, reply, value, logs));
  try {
    const response = await app.inject({ method: payload ? "POST" : "GET", url: "/api", headers: { "content-type": "application/json" }, ...(payload ? { payload } : {}) });
    return { response, logs: logs.list() };
  } finally { await app.close(); }
}

async function withUpstream(handler: http.RequestListener, run: (url: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
function connect(value: State, url: string) {
  value.packages[0].realServices = [{ id: "r", name: "本地测试服务", baseUrl: url }];
  value.packages[0].activeRealServiceId = "r";
}

test("Proxy 两类混合响应只请求一次，处理压缩和流式上传，记录最终结果并清理旧响应头", async () => {
  let calls = 0;
  const received: string[] = [];
  await withUpstream((req, res) => {
    calls++;
    let body = "";
    req.setEncoding("utf8"); req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push(body);
      const bytes = gzipSync(JSON.stringify(real));
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": bytes.length, etag: "old", "set-cookie": ["a=1", "b=2"] });
      res.end(bytes);
    });
  }, async (url) => {
    for (const stream of [false, true]) for (const type of ["real-overrides", "mock-with-real"] as const) {
      const value = state(type, type === "real-overrides" ? ["/data/status"] : ["/data/imageUrl"]);
      connect(value, url);
      const { response, logs } = await proxyRequest(value, stream, stream ? '{"upload":"once"}' : undefined);
      assert.equal(response.statusCode, 201);
      assert.deepEqual(response.json(), type === "real-overrides" ? { data: { ...real.data, status: "APPROVED" } } : { data: { ...mock.data, imageUrl: "fresh-signed-url" } });
      assert.equal(response.headers["content-encoding"], undefined);
      assert.equal(response.headers.etag, undefined);
      assert.deepEqual(response.headers["set-cookie"], ["a=1", "b=2"]);
      assert.equal(logs[0].outcome, "mocked");
      assert.deepEqual(JSON.parse(logs[0].response.body!), response.json());
    }
  });
  assert.equal(calls, 4);
  assert.deepEqual(received, ["", "", '{"upload":"once"}', '{"upload":"once"}']);
});

test("混合请求失败不重试、不使用旧 Mock，不影响完整 Mock", async () => {
  for (const behavior of ["disconnect", "invalid-json", "missing", "http-error"] as const) {
    let calls = 0;
    await withUpstream((_req, res) => {
      calls++;
      if (behavior === "disconnect") { res.destroy(); return; }
      res.writeHead(behavior === "http-error" ? 503 : 200, { "content-type": "application/json" });
      res.end(behavior === "invalid-json" ? "not json" : "{}");
    }, async (url) => {
      const value = state("mock-with-real"); connect(value, url);
      const result = await proxyRequest(value);
      assert.equal(result.response.statusCode, 502);
      assert.equal(result.logs[0].outcome, "error");
      value.packages[0].apis[0].scenarios[0].responseType = "mock";
      const unaffected = await proxyRequest(value);
      assert.equal(unaffected.response.statusCode, 201);
      assert.deepEqual(unaffected.response.json(), mock);
    });
    assert.equal(calls, 1);
  }
  assert.equal((await proxyRequest(state("mock-with-real"))).response.statusCode, 502);
  assert.equal((await proxyRequest(state())).response.statusCode, 201);
});
