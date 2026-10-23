import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { TabTrafficStore } from "./traffic-store.js";
import { CHANNEL, type TrafficEntry, type TrafficPanelMessage, type TrafficStartMessage } from "./protocol.js";

const source = { tabId: 1, frameId: 0, pageUrl: "https://app.test/" };
const start = (id: string, startedAt = 0, body = "{}"): TrafficStartMessage => ({
  channel: CHANNEL, type: "traffic-start",
  entry: { id, source: "fetch", decision: "pending", startedAt, request: { method: "POST", url: "https://api.test/", headers: {}, body } },
});
const storedEntry = (id: string): TrafficEntry => ({ ...start(id).entry, ...source });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
function setup() {
  const disk = new Map<number, TrafficEntry[]>();
  const updates: Array<{ tabId: number; message: TrafficPanelMessage }> = [];
  const storage = {
    async read(tabId: number): Promise<unknown> { return structuredClone(disk.get(tabId) ?? []); },
    async write(tabId: number, entries: TrafficEntry[]) { disk.set(tabId, structuredClone(entries)); },
  };
  const store = new TabTrafficStore(storage, (tabId, message) => updates.push({ tabId, message: structuredClone(message) }));
  return { disk, updates, storage, store };
}

test("三段记录按标签页和 frame 合并；旧快照不覆盖新记录", async () => {
  const { disk, updates, store } = setup();
  disk.set(1, [storedEntry("same"), { ...storedEntry("foreign"), tabId: 2 }]);
  store.record(start("same", 20, "new"), source);
  store.record(start("same", 10), { ...source, frameId: 2 });
  store.record(start("same", 30), { ...source, tabId: 2 });
  store.record({ channel: CHANNEL, type: "traffic-request-body", id: "same", bodyUnavailable: "upload" }, source);
  store.record({ channel: CHANNEL, type: "traffic-request-body", id: "same", body: "patched", bodyTruncated: true }, source);
  store.record({ channel: CHANNEL, type: "traffic-finish", id: "same", decision: "pass", passReason: "unmatched", endedAt: 40, response: { status: 201, headers: {}, body: "ok" } }, source);
  const entries = await store.snapshot(1);
  assert.deepEqual(entries.map((e) => [e.id, e.frameId]), [["same", 2], ["same", 0]]);
  assert.equal(entries[1].request.body, "patched");
  assert.equal(entries[1].request.bodyUnavailable, undefined);
  assert.equal(entries[1].request.bodyTruncated, true);
  assert.equal(entries[1].passReason, "unmatched");
  assert.equal(entries[1].response?.status, 201);
  assert.equal((await store.snapshot(2)).length, 1);
  const count = updates.length;
  store.record({ channel: CHANNEL, type: "traffic-finish", id: "missing", decision: "pass", endedAt: 50 }, source);
  assert.equal(updates.length, count);
  await Promise.all([store.dropTab(1), store.dropTab(2)]);
});

test("内存保留最新 500 条，会话副本仅 200 条且预览 4 KiB，不截断内存", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { disk, store } = setup();
  const body = "x".repeat(5000);
  for (let i = 500; i >= 0; i--) store.record(start(String(i), i, body), source);
  store.record({ channel: CHANNEL, type: "traffic-finish", id: "500", decision: "mock", endedAt: 600, response: { status: 200, headers: {}, body } }, source);
  const entries = await store.snapshot(1);
  assert.equal(entries.length, 500);
  assert.equal(entries[0].id, "1");
  t.mock.timers.tick(600);
  await setImmediate();
  const persisted = disk.get(1)!;
  assert.equal(persisted.length, 200);
  assert.equal(persisted[0].id, "301");
  assert.equal(persisted.at(-1)?.request.body?.length, 4096);
  assert.equal(persisted.at(-1)?.response?.bodyTruncated, true);
  assert.equal(entries.at(-1)?.request.body?.length, 5000);
  assert.equal(entries.at(-1)?.response?.body?.length, 5000);
  const restarted = new TabTrafficStore({ async read() { return persisted; }, async write() {} }, () => {});
  assert.equal((await restarted.snapshot(1)).length, 200);
  await store.dropTab(1);
});

test("清空使正在恢复的旧快照失效，且取消待写入", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { disk, storage, store, updates } = setup();
  const read = deferred<unknown>();
  storage.read = () => read.promise;
  const snapshot = store.snapshot(1);
  await setImmediate();
  store.record(start("new"), source);
  const cleared = store.clear(1);
  read.resolve([storedEntry("old")]);
  assert.deepEqual(await snapshot, []);
  await cleared;
  t.mock.timers.tick(600);
  await setImmediate();
  assert.deepEqual(disk.get(1), []);
  assert.equal(updates.at(-1)?.message.type, "cleared");
});

test("尚未加载就清空，也不会从旧会话快照恢复记录", async () => {
  const { disk, store } = setup();
  disk.set(1, [storedEntry("old")]);
  const saved = store.clear(1);
  assert.deepEqual(await store.snapshot(1), []);
  await saved;
  assert.deepEqual(disk.get(1), []);
});

test("关闭标签页后，晚到恢复不重建记录；重建读取等待清空写入", async () => {
  const { disk, storage, store } = setup();
  const read = deferred<unknown>();
  const originalRead = storage.read;
  storage.read = () => read.promise;
  const snapshot = store.snapshot(1);
  await setImmediate();
  const dropped = store.dropTab(1);
  read.resolve([storedEntry("old")]);
  assert.deepEqual(await snapshot, []);
  await dropped;
  storage.read = originalRead;
  assert.deepEqual(await store.snapshot(1), []);
  assert.deepEqual(disk.get(1), []);
});

test("会话存储失败不丢本轮内存记录，也不阻塞之后的写入", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { storage, disk, store } = setup();
  storage.read = async () => { throw new Error("session read failed"); };
  const originalWrite = storage.write;
  let attempts = 0;
  storage.write = async (tabId, entries) => {
    if (attempts++ === 0) throw new Error("session write failed");
    await originalWrite(tabId, entries);
  };
  store.record(start("new"), source);
  assert.equal((await store.snapshot(1))[0].id, "new");
  t.mock.timers.tick(600);
  await setImmediate();
  assert.equal((await store.snapshot(1))[0].id, "new");
  await store.clear(1);
  assert.equal(attempts, 2);
  assert.deepEqual(disk.get(1), []);
});

test("清空写入排在已启动的旧快照之后，旧写不能覆盖清空", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { storage, disk, store } = setup();
  const write = deferred<void>();
  const entered = deferred<void>();
  const originalWrite = storage.write;
  let count = 0;
  storage.write = async (tabId, entries) => {
    if (count++ === 0) { entered.resolve(); await write.promise; }
    await originalWrite(tabId, entries);
  };
  store.record(start("old"), source);
  await store.snapshot(1);
  t.mock.timers.tick(600);
  await entered.promise;
  const cleared = store.clear(1);
  write.resolve();
  await cleared;
  assert.deepEqual(disk.get(1), []);
  assert.deepEqual(await store.snapshot(1), []);
});
