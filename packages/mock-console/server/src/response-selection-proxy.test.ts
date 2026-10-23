import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import Fastify from "fastify";
import { createProxy, hasRequestBody } from "./proxy.js";
import type { State } from "../../shared/types.js";

function state(): State {
  return { currentPackageId: "p", packages: [{ id: "p", name: "p", realServices: [], activeRealServiceId: null, apis: [
    { id: "high", name: "high", enabled: true, priority: 20, matchMode: "AND", matchRules: [{ id: "r", source: "url", field: "path", operator: "equals", value: "/test" }], activeScenarioId: "s", scenarios: [{ id: "s", name: "s", status: 201, delayMs: 0, responseBody: { mock: true } }], responseSelection: { mode: "conditional", branches: [{ id: "b", name: "body", matchMode: "OR", scenarioId: "s", conditions: [{ id: "c", source: "body", field: "/value", operator: "equals", value: 2 }, { id: "h", source: "header", field: "x-mode", operator: "equals", value: "mock" }] }], fallback: { enabled: false, scenarioId: null } } },
    { id: "low", name: "low", enabled: true, priority: 10, matchMode: "AND", matchRules: [{ id: "r", source: "url", field: "path", operator: "equals", value: "/test" }], activeScenarioId: "low-s", scenarios: [{ id: "low-s", name: "low-s", status: 200, delayMs: 0, responseBody: { wrong: true } }] },
  ] }] };
}

test("生产流式入口按 JSON 选择场景，放行原始字节只转发一次，坏 JSON 不被 Fastify 提前拒绝", async () => {
  const received: Buffer[] = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c);
    received.push(Buffer.concat(chunks)); res.end("real");
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const address = upstream.address(); assert.ok(address && typeof address !== "string");
  const s = state(); s.packages[0].realServices = [{ id: "real", name: "real", baseUrl: `http://127.0.0.1:${address.port}` }]; s.packages[0].activeRealServiceId = "real";
  const app = Fastify();
  app.addHook("onRequest", async (req, reply) => { if (hasRequestBody(req)) await createProxy(req, reply, s, undefined, { streamRequestBody: true }); });
  app.setNotFoundHandler((req, reply) => createProxy(req, reply, s));
  try {
    const hit = await app.inject({ method: "POST", url: "/test", headers: { "content-type": "application/json" }, payload: '{"value":2}' });
    assert.equal(hit.statusCode, 201); assert.deepEqual(hit.json(), { mock: true }); assert.equal(received.length, 0);
    const bytes = Buffer.from('{ "value": "2", "text": "中文", "payload": "' + "x".repeat(40000) + '" }\n');
    const pass = await app.inject({ method: "POST", url: "/test", headers: { "content-type": "application/json", "transfer-encoding": "chunked" }, payload: Readable.from([bytes.subarray(0, 11), bytes.subarray(11)]) });
    assert.equal(pass.body, "real"); assert.deepEqual(received[0], bytes); assert.equal(received.length, 1);
    const invalid = "{bad json";
    const forwarded = await app.inject({ method: "POST", url: "/test", headers: { "content-type": "application/json" }, payload: invalid });
    assert.equal(forwarded.body, "real"); assert.equal(received[1].toString(), invalid);
    const header = await app.inject({ method: "POST", url: "/test", headers: { "content-type": "application/json", "x-mode": "mock" }, payload: invalid });
    assert.equal(header.statusCode, 201); assert.equal(received.length, 2);
    const upload = Buffer.from("--boundary\r\nfile\x00data\r\n--boundary--");
    const uploaded = await app.inject({ method: "POST", url: "/test", headers: { "content-type": "multipart/form-data; boundary=boundary" }, payload: upload });
    assert.equal(uploaded.body, "real"); assert.deepEqual(received[2], upload);
    const uploadMock = await app.inject({ method: "POST", url: "/test", headers: { "content-type": "multipart/form-data; boundary=boundary", "x-mode": "mock" }, payload: upload });
    assert.equal(uploadMock.statusCode, 201); assert.equal(received.length, 3);
    s.packages[0].realServices = [];
    const noService = await app.inject({ method: "POST", url: "/test", headers: { "content-type": "application/json" }, payload: "{}" });
    assert.equal(noService.statusCode, 502); assert.match(noService.body, /未配置真实服务/);
  } finally { await app.close(); await new Promise<void>((r, reject) => upstream.close((e) => e ? reject(e) : r())); }
});
