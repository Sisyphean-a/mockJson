import test from "node:test";
import assert from "node:assert/strict";
import { AdminTransportError, createBrowserTransport, MockAdminClient, type AdminTransport } from "./mock-admin-client";
import { createRuntimeEndpoints } from "./runtime-endpoints";

const endpoints = createRuntimeEndpoints({ protocol: "http:", port: "22334" });
const emptyState = JSON.stringify({ currentPackageId: null, packages: [] });

test("客户端通过运行地址和传输边界访问管理 API", async () => {
  const requests: string[] = [];
  const transport: AdminTransport = {
    async send(input) {
      requests.push(input);
      return new Response(emptyState, { status: 200 });
    },
  };
  const client = new MockAdminClient(endpoints, transport);

  await client.getState();

  assert.deepEqual(requests, ["http://127.0.0.1:22333/__mock_admin/state"]);
});

test("客户端读取并清空请求日志", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const transport: AdminTransport = {
    async send(input, init) {
      requests.push({ url: input, method: init.method || "GET" });
      return new Response(
        init.method === "DELETE" ? JSON.stringify({ success: true }) : JSON.stringify({ logs: [] }),
        { status: 200 },
      );
    },
  };
  const client = new MockAdminClient(endpoints, transport);

  assert.deepEqual(await client.getLogs(), { logs: [] });
  assert.deepEqual(await client.clearLogs(), { success: true });
  assert.deepEqual(requests, [
    { url: "http://127.0.0.1:22333/__mock_admin/logs", method: "GET" },
    { url: "http://127.0.0.1:22333/__mock_admin/logs", method: "DELETE" },
  ]);
});

test("客户端用 ETag 缓存未变化的请求日志并在清空后重新同步", async () => {
  const tags: Array<string | null> = [];
  const transport: AdminTransport = {
    async send(_input, init) {
      const method = init.method || "GET";
      if (method === "DELETE") return new Response(JSON.stringify({ success: true }), { status: 200 });

      const tag = new Headers(init.headers).get("if-none-match");
      tags.push(tag);
      if (tag) return new Response(null, { status: 304, headers: { etag: '"v1"' } });
      return new Response(JSON.stringify({ logs: [] }), { status: 200, headers: { etag: '"v1"' } });
    },
  };
  const client = new MockAdminClient(endpoints, transport);

  const first = await client.getLogs();
  const second = await client.getLogs();
  assert.strictEqual(second, first);
  await client.clearLogs();
  await client.getLogs();
  assert.deepEqual(tags, [null, '"v1"', null]);
});

test("客户端合并请求日志增量而不是重复替换完整列表", async () => {
  const first = { id: "first", url: "/first" };
  const second = { id: "second", url: "/second" };
  const requests: string[] = [];
  const transport: AdminTransport = {
    async send(input) {
      requests.push(input);
      if (input.includes("since=%22v1%22"))
        return new Response(JSON.stringify({ logs: [second], reset: false }), { status: 200, headers: { etag: '"v2"' } });
      return new Response(JSON.stringify({ logs: [first] }), { status: 200, headers: { etag: '"v1"' } });
    },
  };
  const client = new MockAdminClient(endpoints, transport);

  assert.deepEqual((await client.getLogs()).logs, [first]);
  assert.deepEqual((await client.getLogs()).logs, [second, first]);
  assert.deepEqual(requests, [
    "http://127.0.0.1:22333/__mock_admin/logs",
    "http://127.0.0.1:22333/__mock_admin/logs?since=%22v1%22",
  ]);
});

test("浏览器传输以浏览器对象作为原生 fetch 接收者", async () => {
  const browser = {
    fetch(this: unknown) {
      assert.equal(this, browser);
      return Promise.resolve(new Response(emptyState, { status: 200 }));
    },
  } as Pick<typeof globalThis, "fetch">;
  const client = new MockAdminClient(endpoints, createBrowserTransport(browser));

  await client.getState();
});

test("浏览器传输保留连接失败的地址和原始原因", async () => {
  const cause = new TypeError("Failed to fetch");
  const browser = {
    fetch() {
      return Promise.reject(cause);
    },
  } as Pick<typeof globalThis, "fetch">;
  const client = new MockAdminClient(endpoints, createBrowserTransport(browser));

  await assert.rejects(client.getState(), (error) => {
    assert.ok(error instanceof AdminTransportError);
    assert.equal(error.url, "http://127.0.0.1:22333/__mock_admin/state");
    assert.equal(error.cause, cause);
    return true;
  });
});
