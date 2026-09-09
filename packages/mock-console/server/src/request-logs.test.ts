import test from "node:test";
import assert from "node:assert/strict";
import { RequestLogStore } from "./request-logs.js";
import type { RequestLog } from "../../shared/types.js";

function entry(name: string): Omit<RequestLog, "id"> {
  return {
    source: "proxy",
    timestamp: "2026-09-04T00:00:00.000Z",
    durationMs: 1,
    packageId: "pkg",
    packageName: "测试包",
    method: "GET",
    host: "mock.local",
    url: `/${name}`,
    outcome: "mocked",
    apiId: "api",
    apiName: "测试接口",
    scenarioId: "scene",
    scenarioName: "成功",
    status: 200,
    response: { contentType: "application/json", body: "{}", byteLength: 2, truncated: false },
  };
}

test("请求日志以内存环形队列保留最新记录并支持清空", () => {
  const logs = new RequestLogStore(2);
  logs.record(entry("first"));
  logs.record(entry("second"));
  logs.record(entry("third"));

  assert.deepEqual(logs.list().map((log) => log.url), ["/third", "/second"]);
  assert.ok(logs.list()[0]?.id);

  logs.clear();
  assert.deepEqual(logs.list(), []);
});

test("日志增量游标只返回新增记录，游标过旧时要求完整重置", () => {
  const logs = new RequestLogStore(2);
  const initialEtag = logs.etag();
  logs.record(entry("first"));
  const firstEtag = logs.etag();
  logs.record(entry("second"));

  assert.deepEqual(logs.listSince(firstEtag), { logs: logs.list().slice(0, 1), reset: false });

  logs.record(entry("third"));
  const incremental = logs.listSince(firstEtag);
  assert.equal(incremental.reset, false);
  assert.deepEqual(incremental.logs.map((log) => log.url), ["/third", "/second"]);

  const reset = logs.listSince(initialEtag);
  assert.equal(reset.reset, true);
  assert.deepEqual(reset.logs.map((log) => log.url), ["/third", "/second"]);
});

test("清空日志会让旧游标重置本地列表", () => {
  const logs = new RequestLogStore();
  logs.record(entry("first"));
  const etag = logs.etag();
  logs.clear();

  assert.deepEqual(logs.listSince(etag), { logs: [], reset: true });
});

test("请求日志数量上限必须是正整数", () => {
  assert.throws(() => new RequestLogStore(0), /正整数/);
  assert.throws(() => new RequestLogStore(1.5), /正整数/);
});
