import test from "node:test";
import assert from "node:assert/strict";
import { MockConfigService, NotFoundError, type StateRepository } from "./config-service.js";
import type { State } from "../../shared/types.js";

class MemoryRepository implements StateRepository {
  constructor(public state: State = { currentPackageId: null, packages: [] }, public failWrites = false) {}
  async read() { return structuredClone(this.state); }
  async write(state: State) {
    if (this.failWrites) throw new Error("write failed");
    this.state = structuredClone(state);
  }
}

test("配置服务拥有 Package、API、Scenario 的完整变更流程", async () => {
  const service = new MockConfigService(new MemoryRepository());
  await service.initialize();

  const packageConfig = await service.createPackage({ name: "测试包" });
  const api = await service.createApi(packageConfig.id, { name: "借款首页" });
  const scenario = await service.createScenario(api.id, { name: "成功", responseBody: { ok: true } });
  const alternate = await service.createScenario(api.id, { name: "备用", responseBody: { ok: false } });

  await service.updateApi(api.id, { enabled: true, priority: 20 });
  await service.activateScenario(api.id, scenario.id);
  await service.updateScenario(scenario.id, { status: 201, delayMs: 10 });

  const state = service.getState();
  assert.equal(state.currentPackageId, packageConfig.id);
  assert.equal(state.packages[0].apis[0].enabled, true);
  assert.equal(state.packages[0].apis[0].activeScenarioId, scenario.id);
  assert.equal(state.packages[0].apis[0].scenarios[0].status, 201);
  assert.equal(state.packages[0].apis[0].scenarios[0].delayMs, 10);

  const secondApi = await service.createApi(packageConfig.id, { name: "另一个接口" });
  const firstPriority = api.priority;
  const secondPriority = secondApi.priority;
  const reorderedScenarios = await service.reorderScenarios(api.id, { ids: [alternate.id, scenario.id] });
  assert.deepEqual(reorderedScenarios.map((item) => item.id), [alternate.id, scenario.id]);
  const reorderedApis = await service.reorderApis(packageConfig.id, { ids: [secondApi.id, api.id] });
  assert.deepEqual(reorderedApis.map((item) => item.id), [secondApi.id, api.id]);
  assert.equal(reorderedApis[0].priority, secondPriority);
  assert.equal(reorderedApis[1].priority, firstPriority);
});

test("删除当前 Package 后选择剩余 Package", async () => {
  const service = new MockConfigService(new MemoryRepository());
  await service.initialize();
  const first = await service.createPackage({ name: "第一个" });
  const second = await service.createPackage({ name: "第二个" });

  const result = await service.deletePackage(first.id);
  assert.equal(result.currentPackageId, second.id);
  assert.equal(service.getState().packages.length, 1);
});

test("排序接口拒绝缺失、重复或未知 ID", async () => {
  const service = new MockConfigService(new MemoryRepository());
  await service.initialize();
  const packageConfig = await service.createPackage({ name: "测试包" });
  const first = await service.createApi(packageConfig.id, { name: "第一个" });
  const second = await service.createApi(packageConfig.id, { name: "第二个" });

  await assert.rejects(() => service.reorderApis(packageConfig.id, { ids: [first.id] }), /接口排序 ID 无效/);
  await assert.rejects(() => service.reorderApis(packageConfig.id, { ids: [first.id, first.id] }), /全部且唯一/);
  await assert.rejects(() => service.reorderApis(packageConfig.id, { ids: [first.id, "missing"] }), /全部且唯一/);
  assert.deepEqual(service.getPackageApis(packageConfig.id).map((item) => item.id), [first.id, second.id]);
});

test("跨层级查找失败统一为 NotFoundError", async () => {
  const service = new MockConfigService(new MemoryRepository());
  await service.initialize();
  await assert.rejects(() => service.updateScenario("missing", {}), NotFoundError);
  await assert.rejects(() => service.createApi("missing", { name: "接口" }), NotFoundError);
});

test("持久化失败时恢复变更前的配置", async () => {
  const repository = new MemoryRepository();
  const service = new MockConfigService(repository);
  await service.initialize();
  const created = await service.createPackage({ name: "稳定配置" });
  repository.failWrites = true;

  await assert.rejects(() => service.updatePackage(created.id, { name: "不应保存" }), /write failed/);
  assert.equal(service.getState().packages[0].name, "稳定配置");
});
