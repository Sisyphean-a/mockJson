import test from "node:test";
import assert from "node:assert/strict";
import { discoverBlockingManager } from "./blocking-manager.js";
import { BLOCKING_MANAGER_CHANNEL, isBlockingConsoleUrl, isBlockingManagerUrl } from "@mock-json/extension-contract/blocking-manager";

const manager = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/blocking-manager.html";

function fakeWindow(url = "http://127.0.0.1:22333/") {
  const listeners = new Set<(event: MessageEvent) => void>();
  let posted: any;
  const target = {
    location: new URL(url),
    addEventListener(_name: string, callback: (event: MessageEvent) => void) { listeners.add(callback); },
    removeEventListener(_name: string, callback: (event: MessageEvent) => void) { listeners.delete(callback); },
    postMessage(message: unknown, origin: string) { posted = { message, origin }; },
  } as unknown as Window;
  return { target, listeners, get posted() { return posted; },
    send(data: unknown, source: unknown = target, origin = target.location.origin) {
      for (const listener of listeners) listener({ data, source, origin } as MessageEvent);
    },
  };
}

test("只向本机正式或开发控制台交接固定的扩展管理页", () => {
  for (const url of ["http://127.0.0.1:22333/", "http://localhost:22334/path"]) assert.equal(isBlockingConsoleUrl(url), true);
  for (const url of ["http://localhost:3000/", "https://localhost:22333/", "http://127.0.0.1.evil:22333/", "http://user@localhost:22333/", "http://192.168.1.1:22333/", "invalid"]) assert.equal(isBlockingConsoleUrl(url), false);
  assert.equal(isBlockingManagerUrl(manager), true);
  for (const url of [manager + "?command=delete", manager.replace("blocking-manager", "popup"), "https://app.test/blocking-manager.html", manager.replace("aaaaaaaa", "xxxxxxxx")]) assert.equal(isBlockingManagerUrl(url), false);
});

test("握手绑定当前窗口、Origin 和随机请求 ID，成功与关闭均释放监听器", async () => {
  const h = fakeWindow();
  const controller = new AbortController();
  const result = discoverBlockingManager(h.target, controller.signal);
  assert.equal(h.posted.origin, h.target.location.origin);
  const response = { channel: BLOCKING_MANAGER_CHANNEL, type: "manager", id: h.posted.message.id, url: manager };
  h.send(response, {}, h.target.location.origin);
  h.send(response, h.target, "https://evil.test");
  h.send({ ...response, id: "wrong" });
  h.send({ ...response, url: "https://evil.test/" });
  assert.equal(h.listeners.size, 1);
  h.send(response);
  assert.equal(await result, manager);
  assert.equal(h.listeners.size, 0);
  const canceled = discoverBlockingManager(h.target, controller.signal);
  const rejection = assert.rejects(canceled, /已关闭/);
  controller.abort(); await rejection;
  assert.equal(h.listeners.size, 0);
});

test("未安装扩展时明确失败，不另建网页侧规则库；非本机页面不启动握手", async () => {
  const h = fakeWindow();
  await assert.rejects(discoverBlockingManager(h.target, new AbortController().signal), /未连接到浏览器扩展/);
  assert.equal(h.listeners.size, 0);
  const external = fakeWindow("http://192.168.1.1:22333/");
  await assert.rejects(discoverBlockingManager(external.target, new AbortController().signal), /请在本机/);
  assert.equal(external.posted, undefined);
});
