import test from "node:test";
import assert from "node:assert/strict";
import type { State } from "../../shared/types.js";
import { MockConfigService, type StateRepository } from "./config-service.js";

class MemoryRepository implements StateRepository {
  constructor(public state: State = { currentPackageId: null, packages: [] }) {}
  async read() { return structuredClone(this.state); }
  async write(state: State) { this.state = structuredClone(state); }
}

test("全局延迟保存后可跨服务重启恢复", async () => {
  const repository = new MemoryRepository();
  const service = new MockConfigService(repository);
  await service.initialize();

  const saved = await service.updateGlobalDelay({ mode: "random", fixedMs: 500, minMs: 120, maxMs: 360 });
  assert.deepEqual(saved, { mode: "random", fixedMs: 500, minMs: 120, maxMs: 360 });

  const restarted = new MockConfigService(repository);
  await restarted.initialize();
  assert.deepEqual(restarted.getState().globalDelay, saved);
});

test("全局延迟拒绝非法参数且失败不改变已提交配置", async () => {
  const service = new MockConfigService(new MemoryRepository());
  await service.initialize();
  const before = structuredClone(service.getState());

  await assert.rejects(service.updateGlobalDelay({ mode: "random", fixedMs: 500, minMs: 900, maxMs: 100 }), /最小值/);
  await assert.rejects(service.updateGlobalDelay({ mode: "fixed", fixedMs: 30001, minMs: 0, maxMs: 0 }), /30000/);
  await assert.rejects(service.updateGlobalDelay({ mode: "unknown", fixedMs: 0, minMs: 0, maxMs: 0 }), /延迟方式/);

  assert.deepEqual(service.getState(), before);
});
