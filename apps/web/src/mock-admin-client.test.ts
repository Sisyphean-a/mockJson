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
