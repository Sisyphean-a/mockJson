import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { BlockingRuleStore } from "./blocking-store.js";
import { blockingDraft } from "./blocking-rules.js";

const input = blockingDraft({ pageUrl: "https://app.test/page", request: { method: "POST", url: "http://localhost:3000/api/logs?time=1" } });

test("IndexedDB 在新建存储实例后恢复规则，启停、编辑、删除均持久化", async t => {
  const factory = new IDBFactory();
  const store = new BlockingRuleStore(factory);
  t.after(() => store.close());
  await store.save(input);
  const [first] = await store.list();
  assert.equal(first.targetUrl, "http://localhost:3000/api/logs");
  await store.close();
  const reopened = new BlockingRuleStore(factory);
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.list(), [first]);
  await reopened.save({ ...first, enabled: false, matchMode: "prefix" }, first.id, first.revision);
  const [edited] = await reopened.list();
  assert.equal(edited.enabled, false);
  assert.equal(edited.matchMode, "prefix");
  assert.notEqual(edited.revision, first.revision);
  await reopened.delete(edited.id, edited.revision);
  assert.deepEqual(await reopened.list(), []);
});

test("重复规则原子拒绝，不影响原记录；失效版本不能覆盖或删除其他页面修改", async t => {
  const store = new BlockingRuleStore(new IDBFactory());
  t.after(() => store.close());
  await store.save(input);
  const [first] = await store.list();
  await assert.rejects(store.save({ ...input, targetUrl: input.targetUrl + "?other=2" }), /已存在相同/);
  assert.deepEqual(await store.list(), [first]);
  const updates = await Promise.allSettled([
    store.save({ ...first, enabled: false }, first.id, first.revision),
    store.save({ ...first, method: "GET" }, first.id, first.revision),
  ]);
  assert.equal(updates.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(updates.filter(result => result.status === "rejected").length, 1);
  await assert.rejects(store.delete(first.id, first.revision), /其他页面修改/);
  await assert.rejects(store.save(input, "missing", "v1"), /修改或删除/);
  assert.equal((await store.list()).length, 1);
});

test("数据库写事务中止时显式失败，没有发布或遗留部分数据", async t => {
  const factory = new IDBFactory();
  const originalOpen = factory.open.bind(factory);
  let abortWrites = true;
  factory.open = (...args: Parameters<IDBFactory["open"]>) => {
    const request = originalOpen(...args);
    request.addEventListener("success", () => {
      const database = request.result;
      const transaction = database.transaction.bind(database);
      database.transaction = (...parameters: Parameters<typeof database.transaction>) => {
        const result = transaction(...parameters);
        if (abortWrites && parameters[1] === "readwrite") queueMicrotask(() => result.abort());
        return result;
      };
    });
    return request;
  };
  const store = new BlockingRuleStore(factory);
  t.after(() => store.close());
  await assert.rejects(store.save(input), /保存屏蔽规则失败/);
  assert.deepEqual(await store.list(), []);
  abortWrites = false;
  await store.save(input);
  assert.equal((await store.list()).length, 1);
});
