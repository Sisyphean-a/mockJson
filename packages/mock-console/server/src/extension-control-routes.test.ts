import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import http from "node:http";
import type { ExtensionControlCommand, ExtensionControlInspection } from "@mock-json/extension-contract";
import type { State } from "../../shared/types.js";
import { MockConfigService } from "./config-service.js";
import { registerExtensionControlRoutes } from "./extension-control-routes.js";
import { registerExtensionRoutes } from "./extension-routes.js";
import { resolveExtensionRequest } from "./runtime-resolver.js";
import { createProxy, hasRequestBody } from "./proxy.js";
import { RequestLogStore } from "./request-logs.js";
import { isValidState } from "./validation.js";

const request = { url: "https://business.test/api", method: "POST", headers: { apiName: "profile" } };
const origin = "chrome-extension://" + "a".repeat(32);
function initialState(): State {
  return { currentPackageId: "p", packages: [{ id: "p", name: "当前测试包", realServices: [], activeRealServiceId: null, apis: [{
    id: "api", name: "身份资料", enabled: true, priority: 10, matchMode: "AND",
    matchRules: [{ id: "r", source: "header", field: "apiName", operator: "equals", value: "profile" }],
    activeScenarioId: "one", responseSelection: { mode: "conditional", branches: [{ id: "b", name: "成功", matchMode: "AND", conditions: [{ id: "c", source: "header", field: "apiName", operator: "equals", value: "profile" }], scenarioId: "one" }], fallback: { enabled: false, scenarioId: null } },
    scenarios: [{ id: "one", name: "成功", status: 200, delayMs: 0, responseBody: { secretBody: "first" } }, { id: "two", name: "失败", status: 400, delayMs: 0, responseBody: { result: "second" } }, { id: "unsupported", name: "信息响应", status: 101, delayMs: 0, responseBody: {} }],
  }, { id: "broad", name: "低优先级", enabled: true, priority: 0, matchMode: "OR", matchRules: [{ id: "broad-r", source: "method", field: "method", operator: "equals", value: "POST" }], activeScenarioId: "broad-scene", scenarios: [{ id: "broad-scene", name: "低优先级响应", status: 200, delayMs: 0, responseBody: {} }] }] }, { id: "other", name: "其他测试包", realServices: [], activeRealServiceId: null, apis: [] }] };
}
async function setup() {
  let saved = initialState();
  let fail = false;
  let wait: (() => Promise<void>) | undefined;
  const service = new MockConfigService({ async read() { return structuredClone(saved); }, async write(state) {
    await wait?.(); if (fail) throw new Error("disk failed"); saved = structuredClone(state);
  } });
  await service.initialize();
  const app = Fastify();
  const logs = new RequestLogStore();
  registerExtensionControlRoutes(app, service);
  registerExtensionRoutes(app, service, logs);
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/__mock_") && hasRequestBody(req)) await createProxy(req, reply, service.getState(), logs, { streamRequestBody: true });
  });
  app.setNotFoundHandler((req, reply) => createProxy(req, reply, service.getState(), logs));
  const inspect = async () => (await app.inject({ method: "POST", url: "/__mock_extension/controls/inspect", headers: { origin }, payload: request })).json<ExtensionControlInspection>();
  const command = (info: ExtensionControlInspection, action: "mock" | "pass" | "scenario", scenarioId?: string) => ({ packageId: info.package!.id, apiId: info.apis[0].id, revision: info.apis[0].revision, action, ...(scenarioId ? { scenarioId } : {}) });
  const apply = (input: unknown) => app.inject({ method: "POST", url: "/__mock_extension/controls/apply", headers: { origin, "content-type": "application/json" }, payload: JSON.stringify(input) });
  return { app, service, logs, inspect, command, apply, fail: () => { fail = true; }, wait: (f: () => Promise<void>) => { wait = f; }, persisted: () => saved };
}

test("菜单按真实匹配规则和优先级查询摘要，包含停用接口，不泄露响应 JSON 或写日志", async () => {
  const h = await setup();
  try {
    await h.service.updateApi("api", { enabled: false });
    const info = await h.inspect();
    assert.equal(info.package?.id, "p");
    assert.deepEqual(info.apis.map(a => a.id), ["api", "broad"]);
    assert.equal(info.matchedApiId, "broad");
    assert.equal(info.apis[0].enabled, false);
    assert.equal(JSON.stringify(info).includes("secretBody"), false);
    assert.equal(h.logs.list().length, 0);
    const unmatched = await h.app.inject({ method: "POST", url: "/__mock_extension/controls/inspect", payload: { url: "https://business.test/other", method: "GET", headers: {} } });
    assert.deepEqual(unmatched.json().apis, []);
  } finally { await h.app.close(); }
});

test("放行是终局决定，保留场景与条件配置，恢复 Mock 不改变原响应模式", async () => {
  const h = await setup();
  try {
    const original = structuredClone(h.service.getState().packages[0].apis[0]);
    let info = await h.inspect();
    assert.equal((await h.apply(h.command(info, "pass"))).statusCode, 200);
    const api = h.service.getState().packages[0].apis[0];
    assert.equal(api.enabled, true); assert.equal(api.passthrough, true);
    assert.deepEqual(api.responseSelection, original.responseSelection);
    assert.deepEqual(api.scenarios, original.scenarios);
    assert.deepEqual(resolveExtensionRequest(h.service.getState(), request), { action: "pass", reason: "api-passthrough" });
    assert.equal(h.persisted().packages[0].apis[0].passthrough, true);
    assert.equal(isValidState(h.persisted()), true);
    const reloaded = new MockConfigService({ async read() { return structuredClone(h.persisted()); }, async write() {} });
    await reloaded.initialize();
    assert.deepEqual(resolveExtensionRequest(reloaded.getState(), request), { action: "pass", reason: "api-passthrough" });
    info = await h.inspect();
    assert.equal((await h.apply(h.command(info, "mock"))).statusCode, 200);
    assert.equal(h.service.getState().packages[0].apis[0].responseSelection?.mode, "conditional");
    assert.equal(resolveExtensionRequest(h.service.getState(), request).action, "mock");
  } finally { await h.app.close(); }
});

test("控制台原有启用、场景选择和保存响应规则都能解除显式放行", async () => {
  const h = await setup();
  try {
    for (const restore of [
      () => h.service.updateApi("api", { enabled: true }),
      () => h.service.activateScenario("api", "one"),
      () => h.service.saveResponseSelection("api", { selection: h.service.getState().packages[0].apis[0].responseSelection, activeScenarioId: "one" }),
    ]) {
      await h.apply(h.command(await h.inspect(), "pass"));
      await restore();
      assert.equal(h.service.getState().packages[0].apis[0].passthrough, false);
      assert.equal(resolveExtensionRequest(h.service.getState(), request).action, "mock");
    }
  } finally { await h.app.close(); }
});

test("选择场景启用固定响应且保留条件草稿，不修改匹配规则或其他接口", async () => {
  const h = await setup();
  try {
    const before = structuredClone(h.service.getState());
    let info = await h.inspect();
    await h.apply(h.command(info, "pass"));
    info = await h.inspect();
    const result = await h.apply(h.command(info, "scenario", "two"));
    assert.equal(result.statusCode, 200);
    const api = h.service.getState().packages[0].apis[0];
    assert.equal(api.activeScenarioId, "two"); assert.equal(api.responseSelection?.mode, "fixed");
    assert.equal(api.passthrough, false);
    assert.deepEqual(api.responseSelection?.branches, before.packages[0].apis[0].responseSelection?.branches);
    assert.deepEqual(api.matchRules, before.packages[0].apis[0].matchRules);
    assert.deepEqual(h.service.getState().packages[0].apis[1], before.packages[0].apis[1]);
    const response = resolveExtensionRequest(h.service.getState(), request);
    assert.ok(response.action === "mock"); assert.equal(response.status, 400);
    const bad = await h.apply(h.command(await h.inspect(), "scenario", "unsupported"));
    assert.equal(bad.statusCode, 400);
  } finally { await h.app.close(); }
});

test("过期菜单、测试包切换、接口移动与未知场景均不能误写", async () => {
  const h = await setup();
  try {
    const stale = h.command(await h.inspect(), "pass");
    await h.service.updateApi("api", { name: "已改名" });
    assert.equal((await h.apply(stale)).statusCode, 409);
    const switched = h.command(await h.inspect(), "pass");
    await h.service.switchPackage("other");
    assert.equal((await h.apply(switched)).statusCode, 409);
    await h.service.switchPackage("p");
    const moved = h.command(await h.inspect(), "pass");
    await h.service.moveApi("api", { packageId: "other" });
    assert.equal((await h.apply(moved)).statusCode, 409);
    assert.equal(h.service.getState().packages[1].apis[0].passthrough, undefined);
  } finally { await h.app.close(); }
});

test("写入期间仍使用旧判定，写入失败恢复配置，旧版配置仍有效", async () => {
  const h = await setup();
  let release = () => {};
  try {
    assert.equal(isValidState(initialState()), true);
    const command = h.command(await h.inspect(), "pass") as ExtensionControlCommand;
    h.wait(() => new Promise<void>(resolve => { release = resolve; }));
    const saving = h.service.applyRequestControl(command);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolveExtensionRequest(h.service.getState(), request).action, "mock");
    release(); await saving;
    assert.equal(resolveExtensionRequest(h.service.getState(), request).action, "pass");
    h.fail();
    h.wait(async () => {});
    await assert.rejects(h.service.applyRequestControl(h.command(await h.inspect(), "mock") as ExtensionControlCommand), /disk failed/);
    assert.equal(h.service.getState().packages[0].apis[0].passthrough, true);
    const broken = initialState(); (broken.packages[0].apis[0] as any).passthrough = "true";
    assert.equal(isValidState(broken), false);
  } finally { release(); await h.app.close(); }
});

test("快捷操作仅接受本机可信 Origin 和 JSON，输入校验不改变状态", async () => {
  const h = await setup();
  try {
    for (const url of ["/__mock_extension/controls/inspect", "/__mock_extension/controls/apply"]) {
      for (const options of [{ headers: { origin: "https://evil.test" } }, { remoteAddress: "192.168.1.20" }]) {
        const r = await h.app.inject({ method: "POST", url, payload: request, ...options });
        assert.equal(r.statusCode, 403);
      }
      assert.equal((await h.app.inject({ method: "POST", url, headers: { "content-type": "text/plain" }, payload: "{}" })).statusCode, 415);
      assert.equal((await h.app.inject({ method: "POST", url, payload: {} })).statusCode, 400);
    }
    const cmd = h.command(await h.inspect(), "scenario", "other-api-scene");
    assert.equal((await h.apply(cmd)).statusCode, 400);
    assert.equal((await h.apply({ ...cmd, action: "unknown" })).statusCode, 400);
    assert.equal(h.service.getState().packages[0].apis[0].passthrough, undefined);
  } finally { await h.app.close(); }
});

test("Proxy 显式放行未配置真实服务时明确报错，不伪装成未命中或低优先级 Mock", async () => {
  const h = await setup();
  try {
    await h.apply(h.command(await h.inspect(), "pass"));
    const response = await h.app.inject({ method: "POST", url: "/api", headers: { apiName: "profile" } });
    assert.equal(response.statusCode, 502);
    assert.match(response.json().error, /已设为放行.*未配置真实服务/);
    assert.equal(h.logs.list()[0].outcome, "error");
    assert.equal(h.logs.list()[0].apiId, "api");
  } finally { await h.app.close(); }
});

test("Proxy 显式放行保留请求体并转发真实服务，不落到低优先级 Mock", async () => {
  const h = await setup(); let calls = 0, received = "";
  const upstream = http.createServer((req, res) => {
    calls++; req.setEncoding("utf8"); req.on("data", chunk => { received += chunk; });
    req.on("end", () => { res.setHeader("content-type", "application/json"); res.end('{"real":true}'); });
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const address = upstream.address() as import("node:net").AddressInfo;
    const real = await h.service.createRealService("p", { name: "本地服务", baseUrl: `http://127.0.0.1:${address.port}` });
    await h.service.activateRealService("p", real.id);
    await h.apply(h.command(await h.inspect(), "pass"));
    const result = await h.app.inject({ method: "POST", url: "/api", headers: { apiName: "profile", "content-type": "application/json" }, payload: '{"amount":12}' });
    assert.equal(result.statusCode, 200); assert.deepEqual(result.json(), { real: true });
    assert.equal(calls, 1); assert.equal(received, '{"amount":12}');
    assert.equal(h.logs.list()[0].apiId, "api");
  } finally { await h.app.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); }
});
