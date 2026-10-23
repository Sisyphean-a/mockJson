import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as protocol from "./protocol.js";

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

function createPanelHarness() {
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
      runtime: {
        connect() {
          return port;
        },
      },
    },
    URL,
    URLSearchParams,
    Date,
    Math,
    setTimeout,
    clearTimeout,
  });
  assert.ok(messageListener);
  return { elements, posted, messageListener };
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
