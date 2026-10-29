import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as protocol from "./protocol.js";
import * as handoff from "./capture-handoff.js";
import * as controls from "./request-controls.js";
import type { ExtensionControlInspection } from "@mock-json/extension-contract";

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
  listeners: Record<string, (...args: any[]) => void> = {};
  attributes: Record<string, string> = {};
  parentElement?: FakeElement;
  tabIndex = -1;
  onFocus = () => {};
  scrollTop = 0;
  clientHeight = 600;
  scrollHeight = 600;
  classList = { add() {}, remove() {}, toggle() {} };

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) { node.parentElement = this; this.children.push(node); }
  }

  replaceChildren(...nodes: FakeElement[]) {
    for (const node of this.children) node.parentElement = undefined;
    this.children = []; this.append(...nodes);
  }

  addEventListener(type: string, listener: (...args: any[]) => void) { this.listeners[type] = listener; }
  removeEventListener(type: string) { delete this.listeners[type]; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  focus() { this.onFocus(); }
  click() { this.listeners.click?.(); }
  contains(node: FakeElement | null): boolean { return this === node || this.children.some(c => c.contains(node)); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); }
  getBoundingClientRect() { return { left: 0, top: 0, bottom: 20, right: 320, width: 320, height: 400 }; }
  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap(child => [child, ...child.querySelectorAll("*")]).filter(child =>
      selector === "*" || (selector.startsWith("button") && child.tagName === "button" && !child.disabled) ||
      (selector === "tr.selected" && child.tagName === "tr" && child.className === "selected"));
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
}

function createPanelHarness(failHandoff = false) {
  const openedUrls: string[] = [];
  const copiedTexts: string[] = [];
  const capturesSent: unknown[] = [];
  const elements = new Map<string, FakeElement>();
  const control = {
    inspection: { package: { id: "p", name: "当前包" }, matchedApiId: "a", apis: [{ id: "a", name: "用户接口", enabled: true, passthrough: false, revision: "a".repeat(64), mode: "fixed", activeScenarioId: "one", mockUnavailableReason: "", scenarios: [{ id: "one", name: "成功", status: 200, responseType: "mock" }, { id: "two", name: "失败", status: 400, responseType: "mock" }] }] } as ExtensionControlInspection,
    error: "", inspectWait: undefined as (() => Promise<void>) | undefined, applyWait: undefined as (() => Promise<void>) | undefined,
  };
  const controlRequests: { url: string; body: any }[] = [];
  const controlSend: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)); controlRequests.push({ url: String(url), body });
    if (String(url).endsWith("/inspect")) { await control.inspectWait?.(); return Response.json(control.inspection); }
    await control.applyWait?.();
    if (control.error) return Response.json({ error: control.error }, { status: 409 });
    const api = control.inspection.apis.find(a => a.id === body.apiId)!;
    api.enabled = true; api.passthrough = body.action === "pass";
    if (body.action === "scenario") { api.activeScenarioId = body.scenarioId; api.mode = "fixed"; }
    return Response.json(api);
  };
  const document = {
    body: new FakeElement("body"), activeElement: undefined as FakeElement | undefined,
    getElementById(id: string) { return elements.get(id); },
    createElement(tag: string) { const element = new FakeElement(tag); element.onFocus = () => { document.activeElement = element; }; return element; },
    addEventListener() {}, removeEventListener() {},
  };
  const window = { location: { search: "?tabId=1" }, innerWidth: 1024, innerHeight: 768, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
  const menuExports = {};
  const menuSource = readFileSync(new URL("./panel-context-menu.ts", import.meta.url), "utf8");
  new Script(transpileModule(menuSource, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText).runInNewContext({
    exports: menuExports, require(name: string) {
      if (name === "./capture-handoff.js") return handoff;
      assert.equal(name, "./request-controls.js");
      return { ...controls, inspectRequestControls: (entry: protocol.TrafficEntry, signal: AbortSignal) => controls.inspectRequestControls(entry, signal, controlSend), applyRequestControl: (command: Parameters<typeof controls.applyRequestControl>[0]) => controls.applyRequestControl(command, controlSend) };
    }, document, window, URL, AbortController, Error,
  });
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
      if (name === "./panel-context-menu.js") return menuExports;
      assert.equal(name, "./protocol.js");
      return protocol;
    },
    document, window,
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
  return { elements, posted, messageListener, openedUrls, capturesSent, copiedTexts, control, controlRequests, document, menu: document.body.children[0] };
}

const menuEntry: protocol.TrafficEntry = { id: "menu", tabId: 1, frameId: 0, pageUrl: "https://app.test", source: "fetch", decision: "mock", startedAt: 1, endedAt: 2, request: { url: "https://api.test/users", method: "POST", headers: { apiName: "users" }, body: "private request" }, response: { status: 200, headers: {}, body: '{"ok":true}' } };
const tick = () => new Promise(resolve => setImmediate(resolve));
const menuItem = (root: FakeElement, text: string) => root.querySelectorAll("*").find(element => element.textContent === text)!;
function openRowMenu(h: ReturnType<typeof createPanelHarness>, entry = menuEntry) {
  h.messageListener({ type: "snapshot", captureTab: true, entries: [entry] });
  h.elements.get("rows")!.children[0].listeners.contextmenu({ preventDefault() {}, clientX: 900, clientY: 700 });
}

test("右键选中请求、按需读取配置，选择场景仅更新当前测试包，不重放请求", async () => {
  const h = createPanelHarness();
  assert.equal(h.controlRequests.length, 0);
  openRowMenu(h); await tick();
  assert.equal(h.elements.get("detail")!.hidden, false);
  assert.equal(h.menu.hidden, false);
  assert.equal(h.menu.querySelectorAll("*").some(node => node.className === "context-scope"), false);
  assert.deepEqual(h.controlRequests[0].body, { url: menuEntry.request.url, method: "POST", headers: menuEntry.request.headers });
  menuItem(h.menu, "切换响应场景 ›").click();
  assert.equal(menuItem(h.menu, "成功").getAttribute("aria-checked"), "true");
  menuItem(h.menu, "失败").click(); await tick();
  assert.deepEqual(h.controlRequests[1].body, { packageId: "p", apiId: "a", revision: "a".repeat(64), action: "scenario", scenarioId: "two" });
  assert.equal(h.menu.hidden, true);
  assert.match(h.elements.get("toast")!.textContent, /场景已切换/);
});

test("菜单只显示一个 Mock 切换项，按当前状态执行启用或停用", async () => {
  for (const [enabled, passthrough, label, action] of [
    [true, false, "停用 Mock", "pass"],
    [true, true, "启用 Mock", "mock"],
    [false, false, "启用 Mock", "mock"],
  ] as const) {
    const h = createPanelHarness();
    Object.assign(h.control.inspection.apis[0], { enabled, passthrough });
    openRowMenu(h); await tick();
    const toggles = h.menu.querySelectorAll("*").filter(node => ["启用 Mock", "停用 Mock", "放行此接口"].includes(node.textContent));
    assert.deepEqual(toggles.map(node => node.textContent), [label]);
    toggles[0].click(); await tick();
    assert.equal(h.controlRequests[1].body.action, action);
  }
});

test("当前 Mock 无有效场景时仍可停用，未启用时保留场景缺失提示", async () => {
  const h = createPanelHarness();
  h.control.inspection.apis[0].mockUnavailableReason = "请先选择一个浏览器支持的响应场景";
  openRowMenu(h); await tick();
  assert.equal(menuItem(h.menu, "停用 Mock").disabled, false);
  h.control.inspection.apis[0].passthrough = true;
  openRowMenu(h); await tick();
  assert.equal(menuItem(h.menu, "启用 Mock").disabled, true);
  assert.match(menuItem(h.menu, "启用 Mock").title, /选择/);
});

test("右键操作忙碌时防止重复提交，冲突后须明确重新读取配置", async () => {
  const h = createPanelHarness();
  let release = () => {};
  try {
    h.control.applyWait = () => new Promise<void>(resolve => { release = resolve; });
    h.control.error = "当前测试包已切换，请重新读取配置";
    openRowMenu(h); await tick();
    const toggle = menuItem(h.menu, "停用 Mock"); toggle.click(); toggle.click(); await tick();
    assert.equal(h.controlRequests.filter(r => r.url.endsWith("/apply")).length, 1);
    assert.equal(h.menu.getAttribute("aria-busy"), "true");
    h.menu.listeners.keydown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    assert.equal(h.menu.hidden, false);
    release(); await tick();
    assert.equal(menuItem(h.menu, "停用 Mock"), undefined);
    assert.match(menuItem(h.menu, h.control.error).textContent, /测试包已切换/);
    h.control.error = "";
    menuItem(h.menu, "重新读取配置").click(); await tick();
    assert.ok(menuItem(h.menu, "停用 Mock"));
  } finally { release(); }
});

test("关闭菜单忽略晚到结果；键盘可打开菜单和返回请求，未配置时可交接响应", async () => {
  const h = createPanelHarness(); let release = () => {};
  h.control.inspectWait = () => new Promise<void>(resolve => { release = resolve; });
  openRowMenu(h);
  h.menu.listeners.keydown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  release(); await tick();
  assert.equal(h.menu.hidden, true); assert.equal(h.menu.children.length, 0);
  h.control.inspectWait = undefined;
  h.control.inspection.apis = []; h.control.inspection.matchedApiId = null;
  const row = h.elements.get("rows")!.children[0];
  row.listeners.keydown({ key: "F10", shiftKey: true, preventDefault() {} }); await tick();
  assert.equal(h.menu.hidden, false);
  assert.ok(menuItem(h.menu, "此请求尚未配置 Mock 接口"));
  menuItem(h.menu, "保存此响应为新场景…").click(); await tick();
  assert.equal(h.capturesSent.length, 1);
  assert.match(h.openedUrls[0], /#capture=/);
});

test("多接口匹配要求明确选目标，菜单内容安全显示且条件分支切换有提示", async () => {
  const h = createPanelHarness();
  h.control.inspection.apis.push({ ...h.control.inspection.apis[0], id: "b", name: "<script>unsafe</script>", mode: "conditional" });
  openRowMenu(h); await tick();
  assert.equal(menuItem(h.menu, "停用 Mock"), undefined);
  menuItem(h.menu, "<script>unsafe</script> ›").click();
  menuItem(h.menu, "切换响应场景 ›").click();
  assert.ok(menuItem(h.menu, "选择场景后切换为固定响应，保留原条件分支"));
});

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
