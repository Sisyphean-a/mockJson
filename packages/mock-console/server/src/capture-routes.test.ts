import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { MockConfigService, type StateRepository } from "./config-service.js";
import { registerCaptureRoutes } from "./capture-routes.js";
import { resolveExtension } from "./runtime-resolver.js";
import type { State } from "../../shared/types.js";

const capture = {
  request: { method: "POST", url: "https://api.test/users?view=full" },
  response: { status: 201, body: '{"name":"张三","ok":true}' },
};
const form = { packageId: "", apiName: "用户", scenarioName: "真实响应", status: 201, delayMs: 0, responseBody: capture.response.body, activate: false };

async function setup() {
  let persisted: State = { currentPackageId: null, packages: [] };
  let fail = false;
  let delayWrite: (() => Promise<void>) | undefined;
  let now = Date.now();
  const repository: StateRepository = {
    async read() { return structuredClone(persisted); },
    async write(state) {
      if (fail) throw new Error("disk full");
      await delayWrite?.();
      persisted = structuredClone(state);
    },
  };
  const service = new MockConfigService(repository);
  await service.initialize();
  const pkg = await service.createPackage({ name: "测试包" });
  const app = Fastify();
  registerCaptureRoutes(app, service, () => now);
  async function handoff(payload: unknown = capture) {
    return app.inject({ method: "POST", url: "/__mock_extension/captures", headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
  }
  async function save(id: string, input = {}) {
    return app.inject({ method: "POST", url: `/__mock_admin/captures/${id}/save`, payload: { ...form, packageId: pkg.id, ...input } });
  }
  return { app, service, pkg, handoff, save, delayWrites: (fn: () => Promise<void>) => { delayWrite = fn; }, failWrites: (value: boolean) => { fail = value; }, advance: () => { now += 16 * 60_000; } };
}

test("扩展交接仅生成临时草稿，保存后可重试而不重复创建", async (t) => {
  const h = await setup(); t.after(() => h.app.close());
  const response = await h.handoff();
  assert.equal(response.statusCode, 201);
  const { id } = response.json();
  assert.equal(h.service.getPackageApis(h.pkg.id).length, 0);
  const draft = await h.app.inject({ url: `/__mock_admin/captures/${id}` });
  assert.deepEqual(draft.json().request, capture.request);
  assert.equal(draft.headers["cache-control"], "no-store");
  const [first, second] = await Promise.all([h.save(id), h.save(id)]);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(second.json(), first.json());
  const [api] = h.service.getPackageApis(h.pkg.id);
  assert.equal(api.scenarios.length, 1);
  assert.equal(api.activeScenarioId, null);
  assert.equal(api.matchMode, "AND");
  assert.deepEqual(api.matchRules.map(({ source, field, value }) => ({ source, field, value })), [
    { source: "method", field: "method", value: "POST" },
    { source: "url", field: "host", value: "api.test" },
    { source: "url", field: "path", value: "/users" },
  ]);
  assert.deepEqual(api.scenarios[0].responseBody, { name: "张三", ok: true });
  const reloaded = await h.app.inject({ url: `/__mock_admin/captures/${id}` });
  assert.deepEqual(reloaded.json().saved, first.json());
});

test("显式启用后 resolver 返回导入响应，Method 和 host 继续隔离", async (t) => {
  const h = await setup(); t.after(() => h.app.close());
  const { id } = (await h.handoff()).json();
  const saved = await h.save(id, { activate: true, status: 202, delayMs: 25, responseBody: '["edited"]' });
  assert.equal(saved.statusCode, 200);
  const resolve = (url: string, method = "POST") => resolveExtension(h.service.getState(), { url, method, headers: {} }).response;
  assert.deepEqual(resolve("https://api.test/users?view=short"), {
    action: "mock", status: 202, delayMs: 25, body: '["edited"]', headers: { "content-type": "application/json; charset=utf-8" },
  });
  assert.equal(resolve("https://other.test/users").action, "pass");
  assert.equal(resolve(capture.request.url, "GET").action, "pass");
});

test("写盘期间仍使用原配置，提交成功后一次发布", async (t) => {
  const h = await setup(); t.after(() => h.app.close());
  const { id } = (await h.handoff()).json();
  let started!: () => void, release!: () => void;
  const writing = new Promise<void>((resolve) => { started = resolve; });
  h.delayWrites(() => { started(); return new Promise<void>((resolve) => { release = resolve; }); });
  const pending = h.save(id, { activate: true });
  await writing;
  assert.equal(h.service.getPackageApis(h.pkg.id).length, 0);
  assert.equal(resolveExtension(h.service.getState(), { ...capture.request, headers: {} }).response.action, "pass");
  release();
  assert.equal((await pending).statusCode, 200);
  assert.equal(resolveExtension(h.service.getState(), { ...capture.request, headers: {} }).response.action, "mock");
});

test("追加保留既有匹配和条件分支，不能隐式切换响应模式", async (t) => {
  const h = await setup(); t.after(() => h.app.close());
  const api = await h.service.createApi(h.pkg.id, { name: "已有接口" });
  const scene = await h.service.createScenario(api.id, { name: "原响应" });
  await h.service.saveResponseSelection(api.id, { activeScenarioId: scene.id, selection: { mode: "conditional", branches: [], fallback: { enabled: true, scenarioId: scene.id } } });
  const before = structuredClone(api);
  const { id } = (await h.handoff()).json();
  assert.equal((await h.save(id, { apiId: api.id, activate: true })).statusCode, 400);
  assert.equal((await h.save(id, { apiId: api.id })).statusCode, 200);
  const updated = h.service.getPackageApis(h.pkg.id)[0];
  assert.deepEqual(updated.responseSelection, before.responseSelection);
  assert.deepEqual(updated.matchRules, before.matchRules);
  assert.equal(updated.activeScenarioId, scene.id);
  assert.equal(updated.scenarios.length, 2);
});

test("写入失败不留下空接口或场景，原草稿可重试", async (t) => {
  const h = await setup(); t.after(() => h.app.close());
  const { id } = (await h.handoff()).json();
  h.failWrites(true);
  const failed = await h.save(id, { activate: true });
  assert.equal(failed.statusCode, 500);
  assert.equal(h.service.getPackageApis(h.pkg.id).length, 0);
  h.failWrites(false);
  assert.equal((await h.save(id)).statusCode, 200);
  assert.equal(h.service.getPackageApis(h.pkg.id).length, 1);
});

test("草稿过期、测试包变化和错误参数不写入配置", async (t) => {
  const h = await setup(); t.after(() => h.app.close());
  for (const payload of [
    { ...capture, response: { status: 200, body: "not json" } },
    { ...capture, response: { status: 101, body: "{}" } },
    { ...capture, response: { status: 200, body: '"'+ "x".repeat(65536) + '"' } },
    { ...capture, request: { method: "GET", url: "file:///secret" } },
  ]) assert.equal((await h.handoff(payload)).statusCode, 400);
  const { id } = (await h.handoff()).json();
  assert.equal((await h.save(id, { responseBody: "{broken" })).statusCode, 400);
  assert.equal((await h.save(id, { apiId: "missing" })).statusCode, 404);
  const other = await h.service.createPackage({ name: "另一个包" });
  await h.service.switchPackage(other.id);
  assert.equal((await h.save(id)).statusCode, 400);
  assert.equal(h.service.getPackageApis(h.pkg.id).length, 0);
  h.advance();
  assert.equal((await h.app.inject({ url: `/__mock_admin/captures/${id}` })).statusCode, 410);
});

test("完整的多字节 XHR 文本沿用观测字符上限，不按字节再次拒绝", async (t) => {
  const h = await setup(); t.after(() => h.app.close());
  const body = JSON.stringify({ text: "中".repeat(30_000) });
  assert.ok(Buffer.byteLength(body) > 64 * 1024);
  assert.equal((await h.handoff({ ...capture, response: { status: 200, body } })).statusCode, 201);
});

test("交接接口拒绝远程地址、网页来源及非 JSON 表单", async (t) => {
  const h = await setup(); t.after(() => h.app.close());
  for (const options of [
    { remoteAddress: "192.168.1.10" },
    { headers: { origin: "https://evil.test" } },
    { headers: { "content-type": "text/plain" }, payload: JSON.stringify(capture) },
  ]) {
    const result = await h.app.inject({ method: "POST", url: "/__mock_extension/captures", payload: capture, ...options });
    assert.ok([403, 415].includes(result.statusCode), result.body);
  }
  const allowed = await h.app.inject({ method: "POST", url: "/__mock_extension/captures", headers: { origin: "chrome-extension://" + "a".repeat(32) }, payload: capture });
  assert.equal(allowed.statusCode, 201);
});
