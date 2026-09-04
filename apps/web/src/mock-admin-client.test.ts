import test from "node:test";
import assert from "node:assert/strict";
import { adminUrl, MockAdminClient } from "./mock-admin-client";

test("开发页面直接访问 22333 管理 API，不依赖 Vite 代理", async () => {
  const requests: string[] = [];
  const client = new MockAdminClient(async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ currentPackageId: null, packages: [] }), { status: 200 });
  }, { protocol: "http:", hostname: "localhost", port: "22334" });

  await client.getState();
  assert.deepEqual(requests, ["http://127.0.0.1:22333/__mock_admin/state"]);
});

test("客户端以全局对象作为 fetch 接收者", async () => {
  const client = new MockAdminClient(function (this: unknown) {
    assert.equal(this, globalThis);
    return Promise.resolve(new Response(JSON.stringify({ currentPackageId: null, packages: [] }), { status: 200 }));
  });

  await client.getState();
});

test("正式页面继续使用当前来源访问管理 API", () => {
  assert.equal(
    adminUrl("/__mock_admin/state", { protocol: "http:", hostname: "127.0.0.1", port: "22333" }),
    "/__mock_admin/state",
  );
});
