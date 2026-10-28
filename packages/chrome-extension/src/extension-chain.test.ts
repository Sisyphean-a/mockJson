import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as protocol from "./protocol.js";
import * as domains from "./domain-whitelist.js";
import * as health from "./resolver-health.js";
import * as traffic from "./traffic-store.js";

const bridge = readFileSync(new URL("./content-bridge.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("./service-worker.ts", import.meta.url), "utf8");
const compiledWorker = transpileModule(worker, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
}).outputText;

function createWorkerHarness(pageUrl: string, whitelist = ["app.test"], session: Record<string, unknown> = {}, resolverResult: unknown = { action: "pass", reason: "unmatched" }) {
  let listener: (message: unknown, sender: unknown, respond: (response: any) => void) => unknown;
  let connectListener: ((port: any) => void) | undefined;
  const resolverRequests: unknown[] = [];
  const local: Record<string, unknown> = { [domains.WHITELIST_STORAGE_KEY]: whitelist };
  const storage = (values: Record<string, unknown>) => ({
    async get() { return values; },
    async set(changes: Record<string, unknown>) { Object.assign(values, changes); },
  });
  const dependencies: Record<string, unknown> = { "./protocol.js": protocol, "./domain-whitelist.js": domains, "./resolver-health.js": health, "./traffic-store.js": traffic };
  new Script(compiledWorker).runInNewContext({
    exports: {},
    require(name: string) {
      assert.ok(name in dependencies, `未知测试依赖：${name}`);
      return dependencies[name];
    },
    chrome: {
      runtime: {
        onMessage: { addListener(handler: typeof listener) { listener = handler; } },
        onConnect: { addListener(handler: typeof connectListener) { connectListener = handler; } },
      },
      storage: { local: storage(local), session: storage(session) },
      tabs: { async query() { return [{ id: 1, url: pageUrl }]; }, async sendMessage() {} },
    },
    async fetch(url: string, init?: RequestInit) {
      if (url.endsWith(protocol.RESOLVER_PATH)) {
        resolverRequests.push(JSON.parse(String(init?.body)));
        return Response.json(resolverResult);
      }
      assert.ok(url.endsWith(protocol.STATUS_PATH));
      return Response.json({ online: true, hasPackage: true });
    },
    URL, AbortController, setTimeout, clearTimeout,
  });
  const sender = { url: pageUrl, tab: { id: 1, url: pageUrl } };
  return {
    resolverRequests,
    dispatch(message: unknown) { return listener(message, sender, () => {}); },
    send(message: unknown, from: unknown = sender): Promise<any> {
      return new Promise((resolve) => assert.equal(listener(message, from, resolve), true));
    },
    connectPanel() {
      const posted: any[] = [];
      const messageListeners: Array<(message: unknown) => void> = [];
      let disconnectListener: (() => void) | undefined;
      const port = {
        name: protocol.TRAFFIC_PANEL_PORT,
        postMessage(message: unknown) { posted.push(message); },
        disconnect() {},
        onMessage: { addListener(handler: (message: unknown) => void) { messageListeners.push(handler); } },
        onDisconnect: { addListener(handler: () => void) { disconnectListener = handler; } },
      };
      assert.ok(connectListener);
      connectListener(port);
      return {
        posted,
        receive(message: unknown) { for (const handler of messageListeners) handler(message); },
        disconnect() { disconnectListener?.(); },
      };
    },
  };
}

const monitoringQuery = { channel: protocol.CHANNEL, type: "get-monitoring" };
const resolution = (url: string) => ({
  channel: protocol.CHANNEL, type: "resolve", id: "request-1", request: { url, method: "GET", headers: {} },
});

test("后台以页面而非请求目标域名授权，非白名单页面和 frame 不调用 resolver", async () => {
  const harness = createWorkerHarness("https://github.com/octocat/Hello-World");
  for (const sender of [
    { url: "https://github.com/", tab: { id: 1, url: "https://github.com/" } },
    { url: "https://third-party.test/", tab: { id: 1, url: "https://app.test/" } },
    { tab: { id: 1, url: "https://app.test/" } },
  ]) {
    assert.equal((await harness.send(monitoringQuery, sender)).enabled, false);
    assert.equal((await harness.send(resolution("https://app.test/api"), sender)).reason, "disabled");
  }
  assert.equal(harness.resolverRequests.length, 0);
  const popup = await harness.send({ channel: protocol.POPUP_CHANNEL, type: "get-state" });
  assert.equal(popup.ok, true);
  assert.equal(popup.state.pageWhitelisted, false);
  assert.equal(popup.state.effectiveEnabled, false);
});

test("白名单子域名页面可判定跨域 API，Popup 状态与后台一致", async () => {
  const harness = createWorkerHarness("https://child.app.test:8443/page");
  assert.equal((await harness.send(monitoringQuery)).enabled, true);
  assert.equal((await harness.send(resolution("https://api.other.test/api"))).reason, "unmatched");
  assert.equal(harness.resolverRequests.length, 1);
  const popup = await harness.send({ channel: protocol.POPUP_CHANNEL, type: "get-state" });
  assert.equal(popup.state.pageWhitelisted, true);
  assert.equal(popup.state.effectiveEnabled, true);
});

test("空白名单、全局暂停或标签页暂停均禁止后台判定", async () => {
  for (const harness of [
    createWorkerHarness("https://app.test/", []),
    createWorkerHarness("https://app.test/", ["app.test"], { globalEnabled: false }),
    createWorkerHarness("https://app.test/", ["app.test"], { disabledTabIds: [1] }),
  ]) {
    assert.equal((await harness.send(monitoringQuery)).enabled, false);
    assert.equal((await harness.send(resolution("https://api.other.test/api"))).reason, "disabled");
    assert.equal(harness.resolverRequests.length, 0);
    const popup = await harness.send({ channel: protocol.POPUP_CHANNEL, type: "get-state" });
    assert.equal(popup.state.effectiveEnabled, false);
  }
});

test("修改页面白名单后后台与 Popup 立即更新，不清空已有配置", async () => {
  const harness = createWorkerHarness("https://app.test/");
  const response = await harness.send({ channel: protocol.POPUP_CHANNEL, type: "set-whitelist", domains: ["other.test"] });
  assert.equal(response.state.pageWhitelisted, false);
  assert.equal((await harness.send(monitoringQuery)).enabled, false);
  assert.equal((await harness.send(resolution("https://other.test/api"))).reason, "disabled");
  assert.deepEqual(Array.from(response.state.whitelist), ["other.test"]);
});

test("Popup 非白名单页面显示明确状态且标签页开关不可用", async () => {
  const harness = createWorkerHarness("https://github.com/");
  const popupSource = readFileSync(new URL("./popup.ts", import.meta.url), "utf8");
  const compiledPopup = transpileModule(popupSource, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const elements = new Map<string, { checked: boolean; disabled: boolean; textContent: string; addEventListener(): void }>();
  new Script(compiledPopup).runInNewContext({
    exports: {},
    require(name: string) { return name === "./protocol.js" ? protocol : domains; },
    document: { getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, { checked: false, disabled: false, textContent: "", addEventListener() {} });
      return elements.get(id);
    } },
    chrome: { runtime: { sendMessage: (message: unknown) => harness.send(message) } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(elements.get("tab-toggle")?.checked, false);
  assert.equal(elements.get("tab-toggle")?.disabled, true);
  assert.equal(elements.get("tab-detail")?.textContent, "github.com · 不在页面白名单");
  assert.match(elements.get("hint")!.textContent, /不包装 fetch 或 XHR/);
});

test("bridge forwards cancellation and coalesces monitoring state refreshes", () => {
  assert.match(bridge, /type: "cancel"/);
  assert.match(bridge, /cancelledResolutions/);
  assert.match(bridge, /monitoringSync/);
  assert.match(bridge, /monitoring-state-request/);
});

test("multipart 元数据及未采集标记通过 bridge 和后台到达 resolver", async () => {
  const harness = createWorkerHarness("https://app.test/");
  let pageListener: (event: { source: unknown; data: unknown }) => void;
  const posted: Array<{ type: string; result?: { action: string } }> = [];
  const fakeWindow = {
    addEventListener(_type: string, listener: typeof pageListener) { pageListener = listener; },
    postMessage(message: typeof posted[number]) { posted.push(message); },
  };
  const compiledBridge = transpileModule(bridge, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText.replace(/\nexport \{\};?\s*$/, "\n");
  new Script(compiledBridge).runInNewContext({ window: fakeWindow, chrome: { runtime: {
    onMessage: { addListener() {} }, sendMessage: (message: unknown) => harness.send(message),
  } } });
  const request = { url: "https://api.other.test/upload", method: "POST", headers: {}, bodyUnavailable: "upload" };
  pageListener!({ source: fakeWindow, data: { channel: protocol.CHANNEL, type: "resolve", id: "upload", request } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.resolverRequests.length, 1);
  assert.deepEqual(harness.resolverRequests[0], request);
  assert.equal(posted.find((message) => message.type === "resolve-result")?.result?.action, "pass");
  // Rule: 未采集状态不能和文件体或文本体并存。
  pageListener!({ source: fakeWindow, data: { channel: protocol.CHANNEL, type: "resolve", id: "invalid", request: { ...request, body: "file-content" } } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.resolverRequests.length, 1);
  assert.equal(harness.dispatch({ channel: protocol.CHANNEL, type: "resolve", id: "invalid-worker", request: { ...request, bodyUnavailable: "unknown" } }), undefined);
  assert.equal(harness.resolverRequests.length, 1);
});

test("混合指令通过 worker 和 bridge，畸形指令保持原生放行", async () => {
  for (const responseType of ["real-overrides", "mock-with-real", "invalid"]) {
    const result = { action: "transform", responseType, fieldPaths: ["/data/imageUrl"], status: 200, delayMs: 0, body: "{}" };
    const harness = createWorkerHarness("https://app.test/", ["app.test"], {}, result);
    let pageListener: (event: { source: unknown; data: unknown }) => void;
    const posted: any[] = [];
    const fakeWindow = {
      addEventListener(_type: string, listener: typeof pageListener) { pageListener = listener; },
      postMessage(message: unknown) { posted.push(message); },
    };
    const compiledBridge = transpileModule(bridge, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    }).outputText.replace(/\nexport \{\};?\s*$/, "\n");
    new Script(compiledBridge).runInNewContext({ window: fakeWindow, chrome: { runtime: {
      onMessage: { addListener() {} }, sendMessage: (message: unknown) => harness.send(message),
    } } });
    pageListener!({ source: fakeWindow, data: resolution("https://api.other.test/api") });
    await new Promise(resolve => setTimeout(resolve, 10));
    const response = posted.find(message => message.type === "resolve-result")?.result;
    assert.equal(response?.action, responseType === "invalid" ? "pass" : "transform");
    assert.equal(harness.resolverRequests.length, 1);
    if (responseType !== "invalid") assert.deepEqual(JSON.parse(JSON.stringify(response)), result);
  }
  for (const fieldPaths of [[], ["data/url"], ["/bad~2key"]])
    assert.equal(protocol.isRuntimeResponse({ action: "transform", responseType: "mock-with-real", status: 200, delayMs: 0, body: "{}", fieldPaths }), false);
});

test("service worker aborts cancelled resolver requests and protects concurrency", () => {
  assert.match(worker, /pendingResolvers = new Map/);
  assert.match(worker, /pendingResolvers\.get\(message\.id\)\?\.abort\(\)/);
  assert.match(worker, /MAX_RESOLVER_CONCURRENCY = 32/);
  assert.match(worker, /activeResolverCount >= MAX_RESOLVER_CONCURRENCY/);
  assert.match(worker, /timedOut/);
  assert.match(worker, /chrome\.storage\.session/);
  assert.match(worker, /loadResolverHealth/);
});

test("后台缓冲请求观测并按标签页推送给面板", async () => {
  const harness = createWorkerHarness("https://app.test/page");
  const panel = harness.connectPanel();
  panel.receive({ type: "subscribe", tabId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(panel.posted.find((message) => message.type === "snapshot")?.entries.length, 0);

  harness.dispatch({
    channel: protocol.CHANNEL,
    type: "traffic-start",
    entry: {
      id: "fetch-1", source: "fetch", decision: "pending", startedAt: 100,
      request: { method: "POST", url: "https://api.test/a", headers: { authorization: "Bearer x" }, body: "{}" },
    },
  });
  harness.dispatch({
    channel: protocol.CHANNEL,
    type: "traffic-request-body",
    id: "fetch-1",
    body: '{"amount":120}',
  });
  harness.dispatch({
    channel: protocol.CHANNEL,
    type: "traffic-finish",
    id: "fetch-1",
    decision: "pass",
    endedAt: 180,
    response: { status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' },
  });

  const entries = panel.posted.filter((message) => message.type === "entry").map((message) => message.entry);
  assert.ok(entries.length >= 3);
  const last = entries.at(-1);
  assert.equal(last.tabId, 1);
  assert.equal(last.frameId, 0);
  assert.equal(last.pageUrl, "https://app.test/page");
  assert.equal(last.request.body, '{"amount":120}');
  assert.equal(last.decision, "pass");
  assert.equal(last.response.status, 200);
  assert.equal(last.response.body, '{"ok":true}');

  panel.receive({ type: "clear" });
  assert.ok(panel.posted.some((message) => message.type === "cleared"));
});

test("面板可以给非白名单页面单独开启只记录", async () => {
  const harness = createWorkerHarness("https://other.test/", ["app.test"]);
  assert.equal((await harness.send(monitoringQuery)).capture, false);
  const panel = harness.connectPanel();
  panel.receive({ type: "subscribe", tabId: 1 });
  panel.receive({ type: "ping" });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(panel.posted.some((message) => message.type === "pong"));
  panel.receive({ type: "set-capture", enabled: true });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(panel.posted.find((message) => message.type === "state")?.captureTab, true);
  assert.equal((await harness.send(monitoringQuery)).enabled, false);
  assert.equal((await harness.send(monitoringQuery)).capture, true);

  panel.receive({ type: "set-capture", enabled: false });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await harness.send(monitoringQuery)).capture, false);
});
