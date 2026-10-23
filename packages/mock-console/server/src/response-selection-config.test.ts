import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { MockConfigService, type StateRepository } from "./config-service.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerExtensionRoutes } from "./extension-routes.js";
import { RequestLogStore } from "./request-logs.js";
import { isValidState } from "./validation.js";
import type { State, ResponseSelection } from "../../shared/types.js";
import { resolveExtensionRequest } from "./runtime-resolver.js";

async function setup() {
  let disk: State = { currentPackageId: null, packages: [] };
  let fail = false;
  let beforeWrite: (() => Promise<void>) | undefined;
  const repository: StateRepository = {
    async read() { return structuredClone(disk); },
    async write(state) { await beforeWrite?.(); if (fail) throw new Error("disk failed"); disk = structuredClone(state); },
  };
  const service = new MockConfigService(repository);
  await service.initialize();
  const pkg = await service.createPackage({ name: "p" });
  const api = await service.createApi(pkg.id, { name: "a" });
  const first = await service.createScenario(api.id, { name: "first", responseBody: { value: "old" } });
  const target = await service.createScenario(api.id, { name: "target", responseBody: { value: "new" } });
  await service.updateApi(api.id, { matchRules: [{ id: "r", source: "url", field: "path", operator: "equals", value: "/test" }] });
  const selection: ResponseSelection = { mode: "conditional", branches: [{ id: "b", name: "按请求头", matchMode: "AND", scenarioId: target.id, conditions: [{ id: "c", source: "header", field: "x-case", operator: "equals", value: "yes" }] }], fallback: { enabled: false, scenarioId: first.id } };
  return { service, repository, api, first, target, selection, fail: () => { fail = true; }, defer: (callback: () => Promise<void>) => { beforeWrite = callback; } };
}
const req = { url: "https://example.com/test", method: "POST", headers: { "x-case": "yes" } };

test("模式、分支和固定选择原子保存，写入中和失败时仍返回旧响应；并发编辑不丢失", async () => {
  const x = await setup();
  let release!: () => void; let entered!: () => void;
  const ready = new Promise<void>((r) => { entered = r; });
  const waiting = new Promise<void>((r) => { release = r; });
  x.defer(async () => { entered(); await waiting; });
  const save = x.service.saveResponseSelection(x.api.id, { selection: x.selection, activeScenarioId: x.first.id });
  await ready;
  assert.equal(x.api.responseSelection, undefined);
  const pending = resolveExtensionRequest(x.service.getState(), req);
  assert.equal(pending.action, "mock"); if (pending.action === "mock") assert.equal(pending.body, '{"value":"old"}');
  const scenarioSave = x.service.updateScenario(x.target.id, { responseBody: { value: "concurrent" } });
  release(); await Promise.all([save, scenarioSave]);
  const result = resolveExtensionRequest(x.service.getState(), req);
  assert.equal(result.action, "mock"); if (result.action === "mock") assert.equal(result.body, '{"value":"concurrent"}');
  const restarted = new MockConfigService(x.repository); await restarted.initialize();
  assert.deepEqual(restarted.getState(), x.service.getState());
  const previous = structuredClone(x.service.getState());
  x.fail();
  await assert.rejects(x.service.saveResponseSelection(x.api.id, { selection: { ...x.selection, mode: "fixed" }, activeScenarioId: null }), /disk failed/);
  assert.deepEqual(x.service.getState(), previous);
});

test("保存拒绝跨接口/悬空引用，引用删除列出位置，停用模式和关闭兜底仍保护保留配置", async () => {
  const x = await setup();
  await assert.rejects(x.service.saveResponseSelection(x.api.id, { selection: { ...x.selection, branches: [] }, activeScenarioId: "foreign" }), /不存在/);
  const invalid = structuredClone(x.selection); invalid.branches[0].scenarioId = "foreign";
  await assert.rejects(x.service.saveResponseSelection(x.api.id, { selection: invalid, activeScenarioId: x.first.id }), /目标场景/);
  await x.service.saveResponseSelection(x.api.id, { selection: { ...x.selection, mode: "fixed" }, activeScenarioId: x.first.id });
  await assert.rejects(x.service.deleteScenario(x.target.id), /分支「按请求头」/);
  await assert.rejects(x.service.deleteScenario(x.first.id), /已保留的兜底选择/);
  const old = structuredClone(x.service.getState()); delete old.packages[0].apis[0].responseSelection;
  assert.equal(isValidState(old), true);
  assert.equal(isValidState(x.service.getState()), true);
  const corrupt = structuredClone(x.service.getState()); corrupt.packages[0].apis[0].responseSelection!.branches[0].scenarioId = "missing";
  assert.equal(isValidState(corrupt), false);
  await x.service.saveResponseSelection(x.api.id, { selection: { mode: "conditional", branches: [], fallback: { enabled: false, scenarioId: null } }, activeScenarioId: null });
  await x.service.deleteScenario(x.target.id);
});

test("管理 API 保存与 resolver HTTP 端点贯通；零分支放行不需要真实服务", async () => {
  const x = await setup(); const app = Fastify();
  registerAdminRoutes(app, x.service, new RequestLogStore()); registerExtensionRoutes(app, x.service);
  try {
    const path = `/__mock_admin/apis/${x.api.id}/response-selection`;
    const invalid = await app.inject({ method: "PUT", url: path, payload: { selection: { ...x.selection, fallback: { enabled: true, scenarioId: null } }, activeScenarioId: x.first.id } });
    assert.equal(invalid.statusCode, 400);
    const saved = await app.inject({ method: "PUT", url: path, payload: { selection: x.selection, activeScenarioId: x.first.id } });
    assert.equal(saved.statusCode, 200);
    const hit = await app.inject({ method: "POST", url: "/__mock_extension/resolve", payload: req });
    assert.equal(hit.json().body, '{"value":"new"}');
    const pass = await app.inject({ method: "POST", url: "/__mock_extension/resolve", payload: { ...req, headers: {} } });
    assert.equal(pass.json().action, "pass");
  } finally { await app.close(); }
});
