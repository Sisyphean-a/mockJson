import test from "node:test";
import assert from "node:assert/strict";
import { captureUnavailableReason, handoffCapture } from "./capture-handoff.js";
import type { TrafficEntry } from "./protocol.js";

const entry: TrafficEntry = {
  id: "request", tabId: 1, frameId: 0, pageUrl: "https://app.test", source: "fetch", decision: "pass",
  startedAt: 1, endedAt: 2,
  request: { method: "GET", url: "https://api.test/users", headers: { Cookie: "secret" }, body: "private" },
  response: { status: 200, headers: {}, body: '{"ok":true}' },
};

test("仅主动交接完整 JSON，不发送敏感请求数据", async () => {
  let sent: unknown;
  const ticket = { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", expiresAt: Date.now() + 1000 };
  const result = await handoffCapture(entry, async (url, init) => {
    assert.equal(url, "http://127.0.0.1:22333/__mock_extension/captures");
    sent = JSON.parse(String(init?.body));
    return Response.json(ticket, { status: 201 });
  });
  assert.deepEqual(sent, { request: { url: entry.request.url, method: "GET" }, response: { status: 200, body: '{"ok":true}' } });
  assert.deepEqual(result, ticket);
});

test("未完成、失败、空、非 JSON 和截断响应不可保存，包括仍为合法 JSON 的裁剪片段", async () => {
  for (const update of [
    { endedAt: undefined }, { error: { name: "AbortError", message: "aborted" } },
    { response: undefined },
    { response: { status: 200, headers: {}, body: "" } },
    { response: { status: 200, headers: {}, body: "<html>" } },
    { response: { status: 200, headers: {}, body: "1", bodyTruncated: true } },
    { response: { status: 200, headers: {}, bodyUnavailable: "binary" as const } },
    { response: { status: 101, headers: {}, body: "{}" } },
  ]) {
    const invalid = { ...entry, ...update };
    assert.ok(captureUnavailableReason(invalid));
    await assert.rejects(() => handoffCapture(invalid, async () => { throw new Error("不应发送请求"); }));
  }
  for (const body of ["null", "false", "0", '"text"', "[]"]) {
    assert.equal(captureUnavailableReason({ ...entry, response: { status: 200, headers: {}, body } }), "");
  }
});

test("服务离线、旧服务和无效草稿不会伪装成功", async () => {
  await assert.rejects(() => handoffCapture(entry, async () => { throw new TypeError("offline"); }), /22333/);
  await assert.rejects(() => handoffCapture(entry, async () => Response.json({ error: "接口不存在" }, { status: 404 })), /接口不存在/);
  await assert.rejects(() => handoffCapture(entry, async () => Response.json({})), /无效/);
});
