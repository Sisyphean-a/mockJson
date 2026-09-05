import test from "node:test";
import assert from "node:assert/strict";
import { RequestLogStore } from "./request-logs.js";
import type { RequestLog } from "../../shared/types.js";

function entry(name: string): Omit<RequestLog, "id"> {
  return {
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

test("请求日志数量上限必须是正整数", () => {
  assert.throws(() => new RequestLogStore(0), /正整数/);
  assert.throws(() => new RequestLogStore(1.5), /正整数/);
});
