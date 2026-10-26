import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as protocol from "./protocol.js";
import * as handoff from "./capture-handoff.js";

const source = readFileSync(new URL("./panel.ts", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/panel.html", import.meta.url), "utf8");

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  className = "";
  textContent = "";
  title = "";
  hidden = false;
  disabled = false;
  checked = false;
  value = "";
  type = "";
  style: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  scrollTop = 0;
  clientHeight = 600;
  scrollHeight = 600;
  classList = { add() {}, remove() {}, toggle() {} };

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...nodes: FakeElement[]) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]) {
    this.children = nodes;
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
}

function createPanelHarness(failHandoff = false) {
  const openedUrls: string[] = [];
  const copiedTexts: string[] = [];
  const capturesSent: unknown[] = [];
  const elements = new Map<string, FakeElement>();
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], new FakeElement("div"));
  let messageListener: ((message: unknown) => void) | undefined;
  const posted: unknown[] = [];
  const port = {
    postMessage(message: unknown) {
      posted.push(message);
    },
    disconnect() {},
    onMessage: { addListener(listener: (message: unknown) => void) { messageListener = listener; } },
    onDisconnect: { addListener() {} },
  };
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  new Script(compiled).runInNewContext({
    exports: {},
    require(name: string) {
      if (name === "./capture-handoff.js") return {
        ...handoff,
        handoffCapture: (entry: protocol.TrafficEntry) => handoff.handoffCapture(entry, async (_url, init) => {
          if (failHandoff) throw new TypeError("offline");
          capturesSent.push(JSON.parse(String(init?.body)));
          return Response.json({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", expiresAt: Date.now() + 10000 }, { status: 201 });
        }),
      };
      assert.equal(name, "./protocol.js");
      return protocol;
    },
    document: {
      getElementById(id: string) { return elements.get(id); },
      createElement(tag: string) { return new FakeElement(tag); },
    },
    window: {
      location: { search: "?tabId=1" },
      addEventListener() {},
      setTimeout,
      clearTimeout,
    },
    chrome: {
      tabs: { async create({ url }: { url: string }) { openedUrls.push(url); return {}; } },
      runtime: {
        connect() {
          return port;
        },
      },
    },
    navigator: { clipboard: { async writeText(text: string) { copiedTexts.push(text); } } },
    URL,
    URLSearchParams,
    Error,
    Date,
    Math,
    setTimeout,
    clearTimeout,
  });
  assert.ok(messageListener);
  return { elements, posted, messageListener, openedUrls, capturesSent, copiedTexts };
}

test("面板页面元素完整，快照可渲染列表和详情", () => {
  const harness = createPanelHarness();
  const subscribe = harness.posted[0] as { type: string; tabId: number };
  assert.equal(subscribe.type, "subscribe");
  assert.equal(subscribe.tabId, 1);
  harness.messageListener({
    type: "snapshot",
    captureTab: true,
    entries: [{
      id: "fetch-1",
      tabId: 1,
      frameId: 0,
      pageUrl: "https://app.test/",
      source: "fetch",
      decision: "pass",
      startedAt: 1000,
      endedAt: 1120,
      request: { method: "GET", url: "https://api.test/api?x=1", headers: { accept: "application/json" } },
      response: { status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' },
    }],
  });

  const rows = harness.elements.get("rows")!;
  assert.equal(rows.children.length, 1);
  assert.equal(harness.elements.get("summary")!.textContent, "1 / 1");
  assert.equal(harness.elements.get("empty")!.hidden, true);

  const detail = harness.elements.get("detail")!;
  assert.equal(detail.hidden, true);
  rows.children[0].listeners.click();
  assert.equal(detail.hidden, false);
  assert.equal(detail.children.length, 2);
  assert.equal(detail.children[0].className, "detail-head");
  assert.equal(detail.children[1].className, "detail-body");
  const bar = detail.children[0].children[1];
  assert.match(bar.children[1].className, /active/);
});

test("请求和响应头直接显示原值，复制 cURL 保留请求内容", async () => {
  const h = createPanelHarness();
  const entry: protocol.TrafficEntry = {
    id: "headers", tabId: 1, frameId: 0, pageUrl: "https://app.test/", source: "fetch", decision: "pass",
    startedAt: 1000, endedAt: 1100,
    request: {
      method: "POST", url: "https://api.test/users?token=abc",
      headers: { Authorization: "Bearer abc", cOoKiE: "session=abc", "Proxy-Authorization": "Basic abc", "X-Api-Key": "key-abc" },
      body: '{"token":"abc"}',
    },
    response: { status: 200, headers: { "Set-Cookie": "session=xyz; HttpOnly", authorization: "Bearer xyz" }, body: '{"token":"xyz"}' },
  };
  h.messageListener({ type: "snapshot", captureTab: true, entries: [entry] });
  h.elements.get("rows")!.children[0].listeners.click();
  const detail = h.elements.get("detail")!;
  function descendants(root: FakeElement): FakeElement[] {
    return [root, ...root.children.flatMap(descendants)];
  }
  function checkHeaders(headers: Record<string, string>) {
    const table = descendants(detail).find((node) => node.className === "headers")!;
    assert.deepEqual(table.children.map((row) => row.children.map((cell) => cell.textContent)), Object.entries(headers));
  }
  function checkActions(labels: string[]) {
    const actions = descendants(detail).find((node) => node.className === "detail-actions")!;
    assert.deepEqual(actions.children.map((button) => button.textContent), labels);
  }
  checkHeaders(entry.response!.headers);
  checkActions(["保存为 Mock 场景", "打开控制台", "复制 URL", "复制响应"]);
  descendants(detail).find((node) => node.textContent === "请求")!.listeners.click();
  checkHeaders(entry.request.headers);
  checkActions(["保存为 Mock 场景", "打开控制台", "复制 URL", "复制 cURL"]);
  descendants(detail).find((node) => node.textContent === "复制 cURL")!.listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  const curl = h.copiedTexts[0];
  assert.ok(curl.includes(entry.request.url));
  for (const [name, value] of Object.entries(entry.request.headers)) assert.ok(curl.includes(`${name}: ${value}`));
  assert.ok(curl.includes(entry.request.body!));
});

test("面板过滤和清空消息不会抛错", () => {
  const harness = createPanelHarness();
  harness.messageListener({
    type: "snapshot",
    captureTab: false,
    entries: [{
      id: "xhr-1",
      tabId: 1,
      frameId: 0,
      pageUrl: "https://app.test/",
      source: "xhr",
      decision: "mock",
      startedAt: 2000,
      endedAt: 2010,
      request: { method: "POST", url: "https://api.test/api", headers: {}, body: '{"a":1}' },
      response: { status: 200, headers: { "content-type": "application/json" }, body: "{}" },
    }],
  });
  harness.elements.get("filter")!.value = "mock";
  harness.elements.get("filter")!.listeners.change();
  assert.equal(harness.elements.get("rows")!.children.length, 1);
  harness.elements.get("filter")!.value = "fail";
  harness.elements.get("filter")!.listeners.change();
  assert.equal(harness.elements.get("rows")!.children.length, 0);
  harness.messageListener({ type: "cleared" });
  assert.equal(harness.elements.get("rows")!.children.length, 0);
});

test("选中请求可交接到控制台，截断响应禁止保存，离线明确提示", async () => {
  function find(root: FakeElement, text: string): FakeElement | undefined {
    if (root.textContent === text) return root;
    for (const child of root.children) { const found = find(child, text); if (found) return found; }
  }
  const entry: protocol.TrafficEntry = {
    id: "capture", tabId: 1, frameId: 0, pageUrl: "https://app.test/", source: "fetch", decision: "pass",
    startedAt: 1000, endedAt: 1100,
    request: { method: "GET", url: "https://api.test/users", headers: { Cookie: "secret" } },
    response: { status: 200, headers: {}, body: '{"ok":true}' },
  };
  for (const offline of [false, true]) {
    const h = createPanelHarness(offline);
    h.messageListener({ type: "snapshot", captureTab: true, entries: [entry] });
    h.elements.get("rows")!.children[0].listeners.click();
    const button = find(h.elements.get("detail")!, "保存为 Mock 场景")!;
    assert.equal(button.disabled, false);
    button.listeners.click();
    await new Promise((resolve) => setImmediate(resolve));
    if (offline) {
      assert.match(h.elements.get("toast")!.textContent, /22333/);
      assert.equal(h.openedUrls.length, 0);
    } else {
      assert.equal(h.openedUrls[0], "http://127.0.0.1:22333/#capture=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      assert.deepEqual(h.capturesSent, [{ request: { method: "GET", url: entry.request.url }, response: { status: 200, body: '{"ok":true}' } }]);
    }
    h.messageListener({ type: "entry", entry: { ...entry, response: { ...entry.response!, bodyTruncated: true } } });
    const disabled = find(h.elements.get("detail")!, "保存为 Mock 场景")!;
    assert.equal(disabled.disabled, true);
    assert.match(disabled.title, /完整/);
  }
});

test("DevTools 面板已注册并复用独立面板页面", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8"));
  const devtoolsSource = readFileSync(new URL("./devtools.ts", import.meta.url), "utf8");
  assert.equal(manifest.devtools_page, "devtools.html");
  assert.match(source, /chrome\.devtools\?\.inspectedWindow\?\.tabId/);
  assert.match(devtoolsSource, /chrome\.devtools\.panels\.create\("接口面板"/);
  assert.match(devtoolsSource, /panel\.html"/);
});

test("点击清空立即清空本地列表，并忽略清空前快照", () => {
  const harness = createPanelHarness();
  const entry = {
    id: "fetch-old",
    tabId: 1,
    frameId: 0,
    pageUrl: "https://app.test/",
    source: "fetch",
    decision: "pass",
    startedAt: 1000,
    endedAt: 1010,
    request: { method: "GET", url: "https://api.test/old", headers: {} },
    response: { status: 200, headers: {}, body: "old" },
  };
  harness.messageListener({ type: "snapshot", captureTab: true, entries: [entry] });
  const rows = harness.elements.get("rows")!;
  assert.equal(rows.children.length, 1);

  harness.elements.get("clear")!.listeners.click();
  assert.equal(rows.children.length, 0);
  assert.ok(harness.posted.some((message) => (message as { type?: string }).type === "clear"));

  // 清空前构建的旧快照不能把列表重新填回来。
  harness.messageListener({ type: "snapshot", captureTab: true, entries: [entry] });
  assert.equal(rows.children.length, 0);

  harness.messageListener({ type: "entry", entry: { ...entry, id: "fetch-new", startedAt: Date.now() + 1 } });
  assert.equal(rows.children.length, 1);
});
