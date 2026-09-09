import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileRepository } from "./storage.js";
import type { PersistedState, State } from "../../shared/types.js";

const state: State = { currentPackageId: null, packages: [] };

test("并发保存串行执行且不会留下半写文件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mock-storage-"));
  const repo = new JsonFileRepository(join(dir, "state.json"));
  await Promise.all([repo.write(state), repo.write(state), repo.write(state)]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "state.json"), "utf8")), state);
});

test("主配置损坏时恢复有效备份，不用空状态覆盖数据", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mock-storage-"));
  const file = join(dir, "state.json");
  const backup: State = {
    currentPackageId: "p",
    packages: [{ id: "p", name: "恢复包", realServices: [], activeRealServiceId: null, apis: [] }],
  };
  await writeFile(file, "{broken");
  await writeFile(file + ".bak", JSON.stringify(backup));
  const repo = new JsonFileRepository(file);
  assert.deepEqual(await repo.read(), backup);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), backup);
});

test("旧版单一真实服务配置仍可被读取", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mock-storage-"));
  const file = join(dir, "state.json");
  const legacy: PersistedState = {
    currentPackageId: "p",
    packages: [{ id: "p", name: "旧配置", targetBaseUrl: "https://legacy.example.com", apis: [] }],
  };
  await writeFile(file, JSON.stringify(legacy));
  assert.deepEqual(await new JsonFileRepository(file).read(), legacy);
});

test("配置尚不存在时按首次启动返回空状态", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mock-storage-"));
  assert.deepEqual(await new JsonFileRepository(join(dir, "state.json")).read(), state);
});

test("主配置和备份都损坏时明确失败", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mock-storage-"));
  const file = join(dir, "state.json");
  await writeFile(file, "{}");
  await writeFile(file + ".bak", "[]");
  await assert.rejects(() => new JsonFileRepository(file).read(), /无法读取配置文件/);
});
