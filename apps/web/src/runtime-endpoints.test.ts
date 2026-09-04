import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeEndpoints } from "./runtime-endpoints";

test("开发页面统一使用 22333 服务地址", () => {
  const endpoints = createRuntimeEndpoints({ protocol: "http:", port: "22334" });

  assert.equal(endpoints.adminUrl("/__mock_admin/state"), "http://127.0.0.1:22333/__mock_admin/state");
  assert.equal(endpoints.localMockUrl, "http://127.0.0.1:22333");
  assert.equal(endpoints.lanMockUrl, "http://<电脑局域网 IP>:22333/原始路径");
});

test("正式页面的管理 API 保持同源", () => {
  const endpoints = createRuntimeEndpoints({ protocol: "http:", port: "22335" });

  assert.equal(endpoints.adminUrl("/__mock_admin/state"), "/__mock_admin/state");
  assert.equal(endpoints.localMockUrl, "http://127.0.0.1:22335");
});

test("非 HTTP 页面回退到本机 22333", () => {
  const endpoints = createRuntimeEndpoints({ protocol: "file:", port: "" });

  assert.equal(endpoints.adminUrl("/__mock_admin/state"), "http://127.0.0.1:22333/__mock_admin/state");
});
