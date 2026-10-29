import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionControlledApi } from "@mock-json/extension-contract";
import { inspectRequestControls, applyRequestControl, consoleApiUrl } from "./request-controls.js";
import { CHANNEL, isTrafficFinishMessage, type TrafficEntry } from "./protocol.js";

const entry: TrafficEntry = { id: "e", tabId: 1, frameId: 0, pageUrl: "https://app.test", source: "fetch", decision: "pass", startedAt: 1,
  request: { url: "https://api.test/users", method: "POST", headers: { apiName: "users", Cookie: "session" }, body: "private request" },
  response: { status: 200, headers: {}, body: "private response" } };
const api: ExtensionControlledApi = { id: "a", name: "用户接口", enabled: true, passthrough: false, mode: "fixed", revision: "a".repeat(64), activeScenarioId: "s", mockUnavailableReason: "", scenarios: [{ id: "s", name: "成功", status: 200, responseType: "mock" }] };

test("读取只发送匹配元数据，提交只发送作用域、版本和明确动作", async () => {
  let calls = 0;
  await inspectRequestControls(entry, undefined, async (url, init) => {
    calls++; assert.equal(url, "http://127.0.0.1:22333/__mock_extension/controls/inspect");
    assert.deepEqual(JSON.parse(String(init?.body)), { url: entry.request.url, method: "POST", headers: entry.request.headers });
    return Response.json({ package: { id: "p", name: "当前包" }, matchedApiId: "a", apis: [api] });
  });
  const command = { packageId: "p", apiId: "a", revision: api.revision, action: "pass" as const };
  const result = await applyRequestControl(command, async (url, init) => {
    calls++; assert.equal(url, "http://127.0.0.1:22333/__mock_extension/controls/apply");
    assert.deepEqual(JSON.parse(String(init?.body)), command);
    return Response.json({ ...api, passthrough: true });
  });
  assert.equal(result.passthrough, true); assert.equal(calls, 2);
});

test("离线、未知版本、冲突和无效响应明确失败，不重试写入", async () => {
  let calls = 0;
  const command = { packageId: "p", apiId: "a", revision: api.revision, action: "pass" as const };
  await assert.rejects(applyRequestControl(command, async () => { calls++; throw new Error("network"); }), /无法确认/);
  assert.equal(calls, 1);
  await assert.rejects(inspectRequestControls(entry, undefined, async () => { throw new Error("offline"); }), /22333/);
  await assert.rejects(inspectRequestControls(entry, undefined, async () => Response.json({}, { status: 404 })), /更新/);
  await assert.rejects(applyRequestControl(command, async () => Response.json({ error: "当前测试包已切换" }, { status: 409 })), /测试包已切换/);
  for (const invalid of [{}, { package: null, matchedApiId: "missing", apis: [] }, { package: { id: "p", name: "p" }, matchedApiId: "a", apis: [{ ...api, scenarios: [{}] }] }])
    await assert.rejects(inspectRequestControls(entry, undefined, async () => Response.json(invalid)), /无效/);
  await assert.rejects(applyRequestControl(command, async () => Response.json({})), /无法确认/);
});

test("显式放行原因可以通过扩展观测协议，不会被后台拒绝", () => {
  assert.equal(isTrafficFinishMessage({ channel: CHANNEL, type: "traffic-finish", id: "e", decision: "pass", passReason: "api-passthrough", endedAt: 2 }), true);
});

test("接口配置链接绑定测试包且安全编码，不自动切换当前包", () => {
  assert.equal(consoleApiUrl(), "http://127.0.0.1:22333");
  assert.equal(consoleApiUrl("p&1", "a#2"), "http://127.0.0.1:22333/#api=a%232&package=p%261");
});
