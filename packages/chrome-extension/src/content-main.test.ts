import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { ExtensionRuntimeRequest } from "@mock-json/extension-contract";

const source = readFileSync(new URL("./content-main.ts", import.meta.url), "utf8");
const fieldsSource = readFileSync(new URL("../../extension-contract/src/response-fields.ts", import.meta.url), "utf8");
const compiledSource = transpileModule(fieldsSource.replace(/^export /gm, "") + "\n" + source.replace(/^import .*response-fields.*$/m, ""), {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText.replace(/\nexport \{\};?\s*$/, "\n");

function createContentScriptHarness(mode: "pass" | "throw" | "timeout" | "mock" | "invalid", options: { mockBody?: string; nativeResponse?: () => Promise<Response>; now?: () => number; decision?: unknown } = {}) {
  const forwarded: Request[] = [];
  const posted: ExtensionRuntimeRequest[] = [];
  const trafficMessages: Array<{ type: string; id?: string; entry?: any; decision?: string; response?: any; body?: string; bodyTruncated?: boolean; error?: { name: string; message: string } }> = [];
  const cancelled: string[] = [];
  const bodyClones: Request[] = [];
  const messageListeners: Array<(event: { source: unknown; data: unknown }) => void> = [];
  const nativeXhrInstances: NativeXMLHttpRequest[] = [];
  class NativeXMLHttpRequest {
    timeout = 0;
    withCredentials = false;
    responseType = "";
    listeners: Array<{ type: string; listener: EventListener; options?: boolean | AddEventListenerOptions }> = [];
    constructor() {
      nativeXhrInstances.push(this);
    }
    open(..._args: unknown[]) {}
    sentBodies: unknown[] = [];
    send(body?: unknown) { this.sentBodies.push(body); }
    setRequestHeader(_name: string, _value: string) {}
    aborted = false;
    abort() { this.aborted = true; }
    addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) {
      this.listeners.push({ type, listener, options });
    }
    dispatch(type: string) {
      for (const item of [...this.listeners].filter((item) => item.type === type)) {
        if (typeof item.options === "object" && item.options.signal?.aborted) continue;
        if (typeof item.options === "object" && item.options.once) this.removeEventListener(type, item.listener);
        item.listener.call(this, new Event(type));
      }
    }
    removeEventListener(type: string, listener: EventListener) {
      this.listeners = this.listeners.filter((item) => !(item.type === type && item.listener === listener));
    }
  }
  Object.assign(NativeXMLHttpRequest, {
    UNSENT: 0,
    OPENED: 1,
    HEADERS_RECEIVED: 2,
    LOADING: 3,
    DONE: 4,
  });
  const fakeWindow = {
    fetch(input: RequestInfo | URL) {
      forwarded.push(input as Request);
      return options.nativeResponse?.() ?? Promise.resolve(new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }));
    },
    XMLHttpRequest: NativeXMLHttpRequest,
    location: { hostname: "upload.test", port: "443", href: "https://upload.test/" },
    addEventListener(type: string, listener: (event: { source: unknown; data: unknown }) => void) {
      if (type === "message") messageListeners.push(listener);
    },
    postMessage(message: { type?: string; id?: string; request?: ExtensionRuntimeRequest; entry?: unknown; decision?: string; response?: unknown; body?: string }) {
      if (message.type === "monitoring-state-request") return;
      if (message.type === "cancel") { cancelled.push(message.id!); return; }
      if (message.type?.startsWith("traffic-")) {
        trafficMessages.push(message as (typeof trafficMessages)[number]);
        return;
      }
      if (message.type !== "resolve") return;
      if (message.request) posted.push(message.request);
      if (mode === "throw") throw new Error("bridge unavailable");
      if (mode === "timeout") return;
      queueMicrotask(() => {
        for (const listener of messageListeners) {
          listener({
            source: fakeWindow,
            data: {
              channel: "__mock_console_extension_v1",
              type: "resolve-result",
              id: message.id,
              result: options.decision ?? (mode === "invalid" ? undefined : mode === "mock"
                ? { action: "mock", status: 200, delayMs: 0, body: options.mockBody ?? "{}", headers: { "content-type": "application/json" } }
                : { action: "pass" }),
            },
          });
        }
      });
    },
    setTimeout(callback: (...args: any[]) => void, delay?: number) {
      if (mode === "timeout") {
        queueMicrotask(callback);
        return 1;
      }
      return globalThis.setTimeout(callback, delay);
    },
    clearTimeout,
  } as any;
  const originalFetch = fakeWindow.fetch;
  const originalXMLHttpRequest = fakeWindow.XMLHttpRequest;
  const sandbox = {
    window: fakeWindow,
    Request: class extends Request {
      clone() { bodyClones.push(this); return super.clone(); }
    },
    Response,
    Headers,
    AbortController,
    DOMException,
    Event,
    Blob,
    FormData,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    URLSearchParams,
    URL,
    XMLHttpRequest: NativeXMLHttpRequest,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    ...(options.now ? { performance: { timeOrigin: 1000, now: options.now } } : {}),
  };
  new Script(compiledSource).runInNewContext(sandbox);
  const messageListener = messageListeners[0];
  assert.ok(messageListener);
  return { fakeWindow, forwarded, posted, cancelled, trafficMessages, bodyClones, messageListener, originalFetch, originalXMLHttpRequest, nativeXhrInstances };
}

async function runForwardedFetch(
  mode: "pass" | "throw" | "timeout",
  request: Request,
  whitelist = ["upload.test"],
) {
  const harness = createContentScriptHarness(mode);
  harness.messageListener({
    source: harness.fakeWindow,
    data: {
      channel: "__mock_console_extension_v1",
      type: "monitoring-state",
      enabled: true,
      whitelist,
    },
  });
  await harness.fakeWindow.fetch(request);
  assert.equal(harness.forwarded.length, 1);
  return harness.forwarded[0];
}

test("MAIN world 只引入可内联的纯 JSON 组合函数，构建阶段核验无运行时 import", () => {
  assert.doesNotMatch(source.replace(/^import .*response-fields.*$/m, ""), /^import(?!\s+type\b)/m);
  assert.doesNotMatch(source, /^export\b/m);
});

test("resolver 超时、异常或无效结果均原生放行，且保留一次性请求体", async () => {
  for (const mode of ["timeout", "throw", "invalid"] as const) {
    const harness = createContentScriptHarness(mode);
    harness.messageListener({ source: harness.fakeWindow, data: {
      channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
    } });
    const request = new Request("https://upload.test/api", { method: "POST", body: "one-shot" });
    const response = await harness.fakeWindow.fetch(request);
    assert.equal(await response.text(), "ok");
    assert.equal(harness.forwarded.length, 1);
    assert.equal(await harness.forwarded[0].text(), "one-shot");
    assert.equal(harness.posted.length, 1);
  }
});

test("native fetch and XMLHttpRequest stay untouched before monitoring is enabled", () => {
  const harness = createContentScriptHarness("pass");
  assert.equal(harness.fakeWindow.fetch, harness.originalFetch);
  assert.equal(harness.fakeWindow.XMLHttpRequest, harness.originalXMLHttpRequest);
});

test("非白名单页面保持 fetch 和 XHR 原样，即使请求目标命中白名单", async () => {
  const harness = createContentScriptHarness("pass");
  harness.messageListener({
    source: harness.fakeWindow,
    data: {
      channel: "__mock_console_extension_v1",
      type: "monitoring-state",
      enabled: true,
      whitelist: ["api.other.test"],
    },
  });
  assert.equal(harness.fakeWindow.fetch, harness.originalFetch);
  assert.equal(harness.fakeWindow.XMLHttpRequest, harness.originalXMLHttpRequest);
  await harness.fakeWindow.fetch("https://api.other.test/api");
  assert.equal(harness.posted.length, 0);
});

test("白名单页面的跨域 fetch 和 XHR 请求均进入判定", async () => {
  const harness = createContentScriptHarness("mock");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
  } });
  const response = await harness.fakeWindow.fetch("https://api.other.test/api");
  assert.equal(response.status, 200);
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("GET", "https://api.other.test/api");
  xhr.send();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(harness.posted.map((request) => request.url), ["https://api.other.test/api", "https://api.other.test/api"]);
  assert.equal(harness.forwarded.length, 0);
});

test("清空白名单或暂停后恢复原生 API，已保存的包装也不再判定", async () => {
  for (const state of [{ enabled: true, whitelist: [] }, { enabled: false, whitelist: ["upload.test"] }, { enabled: true, whitelist: ["other.test"] }]) {
    const harness = createContentScriptHarness("mock");
    const update = (enabled: boolean, whitelist: string[]) => harness.messageListener({ source: harness.fakeWindow, data: {
      channel: "__mock_console_extension_v1", type: "monitoring-state", enabled, whitelist,
    } });
    update(true, ["upload.test"]);
    const savedFetch = harness.fakeWindow.fetch;
    update(state.enabled, state.whitelist);
    assert.equal(harness.fakeWindow.fetch, harness.originalFetch);
    assert.equal(harness.fakeWindow.XMLHttpRequest, harness.originalXMLHttpRequest);
    const request = new Request("https://upload.test/api");
    await savedFetch(request);
    assert.equal(harness.forwarded[0], request);
    assert.equal(harness.posted.length, 0);
  }
});

test("XHR removeEventListener detaches before a direct fallback reinstalls listeners", async () => {
  const harness = createContentScriptHarness("pass");
  harness.messageListener({
    source: harness.fakeWindow,
    data: {
      channel: "__mock_console_extension_v1",
      type: "monitoring-state",
      enabled: true,
      whitelist: ["upload.test"],
    },
  });
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  const listener = () => {};
  xhr.open("GET", "https://upload.test/api");
  // 重复注册与原生 addEventListener 一样幂等，移除一次后不应再被装回原生实例。
  xhr.addEventListener("load", listener);
  xhr.addEventListener("load", listener);
  xhr.removeEventListener("load", listener);
  xhr.send();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const native = harness.nativeXhrInstances.at(-1);
  assert.ok(native);
  assert.equal(native.listeners.filter((item) => item.listener === listener).length, 0);
});

test("非白名单页面的 fetch 保留原始 Request 和一次性请求体", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("ignored-payload"));
      controller.close();
    },
  });
  const original = new Request("https://other.test/upload", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const forwarded = await runForwardedFetch("pass", original, ["other.test"]);
  assert.equal(forwarded, original);
  assert.equal(await forwarded.text(), "ignored-payload");
});

test("已有 Request 的 JSON 请求体可记录且原生放行仍保留原文", async () => {
  const payload = '{"access_token":"secret","message":"中文"}';
  const forwarded = await runForwardedFetch("pass", new Request("https://upload.test/api", {
    method: "POST", headers: { "content-type": "application/json" }, body: payload,
  }));
  assert.equal(await forwarded.text(), payload);
});

test("Mock fetch 将完整原文请求体随现有判定发送，未额外发出目标请求", async () => {
  const harness = createContentScriptHarness("mock");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
  } });
  const payload = JSON.stringify({ password: "secret", amount: 120, remark: "中文 😀" });
  const result = await harness.fakeWindow.fetch("https://upload.test/api?token=secret", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer secret" }, body: payload,
  });
  assert.equal(result.status, 200);
  assert.equal(harness.forwarded.length, 0);
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].url, "https://upload.test/api?token=secret");
  assert.equal(harness.posted[0].headers.authorization, "Bearer secret");
  assert.equal(harness.posted[0].body, payload);
});

test("XHR 文本请求体随原有 resolver 判定发送", async () => {
  const harness = createContentScriptHarness("mock");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
  } });
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("POST", "https://upload.test/api");
  xhr.setRequestHeader("Authorization", "Bearer secret");
  xhr.send("password=secret&amount=120");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].headers.Authorization, "Bearer secret");
  assert.equal(harness.posted[0].body, "password=secret&amount=120");
});

test("超过现有本地 resolver 容量仍按原规则判定并显式标记请求体未记录", async () => {
  const harness = createContentScriptHarness("mock");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
  } });
  const result = await harness.fakeWindow.fetch("https://upload.test/api", { method: "POST", body: "\\".repeat(600_000) });
  assert.equal(result.status, 200);
  assert.equal(harness.posted.length, 1);
  assert.equal(harness.posted[0].body, undefined);
  assert.equal(harness.posted[0].bodyUnavailable, "too-large");
});

for (const mode of ["mock", "pass", "throw", "timeout"] as const) {
  test(`multipart fetch ${mode}：只判定元数据，命中不上传，放行保留文件`, async () => {
    const harness = createContentScriptHarness(mode);
    harness.messageListener({ source: harness.fakeWindow, data: {
      channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
    } });
    const form = new FormData();
    form.append("file", new Blob(["file-payload"], { type: "image/png" }), "upload.png");
    form.append("name", "中文");
    const response = await harness.fakeWindow.fetch("https://upload.test/upload", {
      method: "POST", headers: { "X-Trace": "upload" }, body: form,
    });
    assert.equal(harness.posted.length, 1);
    assert.equal(harness.posted[0].url, "https://upload.test/upload");
    assert.equal(harness.posted[0].method, "POST");
    assert.equal(harness.posted[0].headers["x-trace"], "upload");
    assert.match(harness.posted[0].headers["content-type"], /^multipart\/form-data; boundary=/);
    assert.equal(harness.posted[0].body, undefined);
    assert.equal(harness.posted[0].bodyUnavailable, "upload");
    assert.equal(harness.bodyClones.length, 0);
    if (mode === "mock") {
      assert.equal(await response.text(), "{}");
      assert.equal(harness.forwarded.length, 0);
    } else {
      assert.equal(harness.forwarded.length, 1);
      const forwarded = await harness.forwarded[0].formData();
      assert.equal(forwarded.get("name"), "中文");
      const file = forwarded.get("file") as File;
      assert.equal(file.name, "upload.png");
      assert.equal(await file.text(), "file-payload");
    }
  });

  test(`FormData XHR ${mode}：不传文件体，放行保留 send 时的字段和文件`, async () => {
    const harness = createContentScriptHarness(mode);
    harness.messageListener({ source: harness.fakeWindow, data: {
      channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
    } });
    const form = new FormData();
    form.append("file", new Blob(["file-payload"], { type: "text/plain" }), "upload.txt");
    form.append("name", "原始值");
    form.append("name", "重复字段");
    form.append("remove", "保留此字段");
    form.append("empty", "");
    const originalFile = form.get("file") as File;
    const xhr = new harness.fakeWindow.XMLHttpRequest();
    xhr.open("POST", "https://upload.test/upload");
    xhr.setRequestHeader("X-Trace", "upload");
    xhr.send(form);
    form.set("name", "发送后修改");
    form.delete("file");
    form.delete("remove");
    form.append("added", "发送后新增");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(harness.posted.length, 1);
    assert.equal(harness.posted[0].method, "POST");
    assert.equal(harness.posted[0].headers["X-Trace"], "upload");
    assert.equal(harness.posted[0].body, undefined);
    assert.equal(harness.posted[0].bodyUnavailable, "upload");
    const sent = harness.nativeXhrInstances.flatMap((instance) => instance.sentBodies);
    if (mode === "mock") {
      assert.equal(xhr.status, 200);
      assert.equal(xhr.responseText, "{}");
      assert.equal(sent.length, 0);
    } else {
      assert.equal(sent.length, 1);
      const forwarded = sent[0] as FormData;
      assert.deepEqual(forwarded.getAll("name"), ["原始值", "重复字段"]);
      assert.equal(forwarded.get("remove"), "保留此字段");
      assert.equal(forwarded.get("empty"), "");
      assert.equal(forwarded.has("added"), false);
      const fieldOrder: string[] = [];
      forwarded.forEach((_value, name) => fieldOrder.push(name));
      assert.deepEqual(fieldOrder, ["file", "name", "name", "remove", "empty"]);
      const file = forwarded.get("file") as File;
      assert.equal(file, originalFile);
      assert.equal(file.name, "upload.txt");
      assert.equal(file.type, "text/plain");
      assert.equal(await file.text(), "file-payload");
    }
  });
}

test("显式 multipart Header 的 fetch 和 XHR 也不采集文本体", async () => {
  const harness = createContentScriptHarness("mock");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
  } });
  await harness.fakeWindow.fetch("https://upload.test/upload", {
    method: "POST", headers: { "Content-Type": "Multipart/Form-Data; boundary=test" }, body: "file-content",
  });
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("POST", "https://upload.test/upload");
  xhr.setRequestHeader("cOnTeNt-TyPe", "Multipart/Form-Data; boundary=test");
  xhr.send("file-content");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.posted.length, 2);
  for (const request of harness.posted) {
    assert.equal(request.bodyUnavailable, "upload");
    assert.equal(request.body, undefined);
  }
  assert.equal(harness.bodyClones.length, 0);
  assert.equal(harness.forwarded.length, 0);
});

test("二进制 fetch 和 XHR 仍直接放行，不进入 resolver", async () => {
  const harness = createContentScriptHarness("mock");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
  } });
  await harness.fakeWindow.fetch("https://upload.test/upload", {
    method: "POST", body: new Blob(["binary-payload"], { type: "image/png" }),
  });
  assert.equal(await harness.forwarded[0].text(), "binary-payload");
  const body = new Blob(["binary-payload"]);
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("POST", "https://upload.test/upload");
  xhr.send(body);
  assert.equal(harness.nativeXhrInstances.at(-1)?.sentBodies[0], body);
  assert.equal(harness.posted.length, 0);
});

test("fetch pass-through keeps FormData files and ReadableStream bodies", async () => {
  const form = new FormData();
  form.append("file", new Blob(["form-payload"], { type: "text/plain" }), "upload.txt");
  const forwardedForm = await runForwardedFetch(
    "pass",
    new Request("https://upload.test/upload", { method: "POST", body: form }),
  );
  assert.match(await forwardedForm.text(), /form-payload/);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("stream-payload"));
      controller.close();
    },
  });
  const forwardedStream = await runForwardedFetch(
    "timeout",
    new Request("https://upload.test/upload", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" }),
  );
  assert.equal(await forwardedStream.text(), "stream-payload");

  const forwardedBlob = await runForwardedFetch(
    "throw",
    new Request("https://upload.test/upload", {
      method: "POST",
      body: new Blob(["blob-payload"], { type: "image/png" }),
    }),
  );
  assert.equal(await forwardedBlob.text(), "blob-payload");
});

test("面板记录 Mock fetch 的请求体、判定和响应体", async () => {
  const harness = createContentScriptHarness("mock");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, capture: true, whitelist: ["upload.test"],
  } });
  await harness.fakeWindow.fetch("https://upload.test/api?token=secret", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
    body: '{"amount":120}',
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const start = harness.trafficMessages.find((message) => message.type === "traffic-start");
  assert.ok(start?.entry);
  assert.equal(start.entry.request.method, "POST");
  assert.equal(start.entry.request.url, "https://upload.test/api?token=secret");
  assert.equal(start.entry.request.headers.authorization, "Bearer secret");
  assert.equal(start.entry.request.body, '{"amount":120}');
  const finish = harness.trafficMessages.find((message) => message.type === "traffic-finish");
  assert.ok(finish);
  assert.equal(finish.decision, "mock");
  assert.equal(finish.response?.status, 200);
  assert.equal(finish.response?.body, "{}");
});

test("面板记录放行 fetch 的真实响应体和状态", async () => {
  const harness = createContentScriptHarness("pass");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
  } });
  await harness.fakeWindow.fetch("https://upload.test/api");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const finish = harness.trafficMessages.find((message) => message.type === "traffic-finish");
  assert.ok(finish);
  assert.equal(finish.decision, "pass");
  assert.equal(finish.response?.status, 200);
  assert.equal(finish.response?.body, "ok");
});

test("只记录模式不调用 resolver，仍上报请求和响应", async () => {
  const harness = createContentScriptHarness("pass");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: false, capture: true, whitelist: [],
  } });
  assert.notEqual(harness.fakeWindow.fetch, harness.originalFetch);
  await harness.fakeWindow.fetch("https://other.test/api", { method: "POST", body: "a=1" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.posted.length, 0);
  const start = harness.trafficMessages.find((message) => message.type === "traffic-start");
  assert.ok(start?.entry);
  assert.equal(start.entry.decision, "capture");
  const bodyPatch = harness.trafficMessages.find((message) => message.type === "traffic-request-body");
  assert.equal(bodyPatch?.body, "a=1");
  const finish = harness.trafficMessages.find((message) => message.type === "traffic-finish");
  assert.equal(finish?.decision, "capture");
  assert.equal(finish?.response?.body, "ok");
});

test("关闭只记录后恢复原生 fetch 和 XHR", () => {
  const harness = createContentScriptHarness("pass");
  const state = (enabled: boolean, capture: boolean, whitelist: string[]) => harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled, capture, whitelist,
  } });
  state(false, true, []);
  assert.notEqual(harness.fakeWindow.fetch, harness.originalFetch);
  state(false, false, []);
  assert.equal(harness.fakeWindow.fetch, harness.originalFetch);
  assert.equal(harness.fakeWindow.XMLHttpRequest, harness.originalXMLHttpRequest);
});

test("面板记录 XHR Mock 的文本请求体和响应体", async () => {
  const harness = createContentScriptHarness("mock");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, capture: true, whitelist: ["upload.test"],
  } });
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("POST", "https://upload.test/api");
  xhr.setRequestHeader("Authorization", "Bearer secret");
  xhr.send("password=secret&amount=120");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const start = harness.trafficMessages.find((message) => message.type === "traffic-start");
  assert.ok(start?.entry);
  assert.equal(start.entry.source, "xhr");
  assert.equal(start.entry.request.body, "password=secret&amount=120");
  const finish = harness.trafficMessages.find((message) => message.type === "traffic-finish");
  assert.equal(finish?.decision, "mock");
  assert.equal(finish?.response?.status, 200);
  assert.equal(finish?.response?.body, "{}");
});

test("二进制 fetch 放行时仍记录请求元数据和真实响应", async () => {
  const harness = createContentScriptHarness("mock");
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: true, whitelist: ["upload.test"],
  } });
  await harness.fakeWindow.fetch("https://upload.test/upload", {
    method: "POST",
    body: new Blob(["binary-payload"], { type: "image/png" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const start = harness.trafficMessages.find((message) => message.type === "traffic-start");
  assert.equal(start?.entry?.request.bodyUnavailable, "binary");
  assert.equal(start?.entry?.request.url, "https://upload.test/upload");
  const finish = harness.trafficMessages.find((message) => message.type === "traffic-finish");
  assert.equal(finish?.decision, "capture");
  assert.equal(finish?.response?.status, 200);
});

const flushTraffic = () => new Promise((resolve) => setTimeout(resolve, 10));
function enableCapture(harness: ReturnType<typeof createContentScriptHarness>, mock = true) {
  harness.messageListener({ source: harness.fakeWindow, data: {
    channel: "__mock_console_extension_v1", type: "monitoring-state", enabled: mock, capture: true, whitelist: ["upload.test"],
  } });
}

test("fetch 和 XHR 的 Mock 响应预览一致截断，不改变页面收到的响应", async () => {
  const body = "x".repeat(70 * 1024);
  const harness = createContentScriptHarness("mock", { mockBody: body });
  enableCapture(harness);
  const response = await harness.fakeWindow.fetch("https://upload.test/api");
  assert.equal(await response.text(), body);
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("POST", "https://upload.test/api");
  xhr.send(body);
  await flushTraffic();
  assert.equal(xhr.responseText, body);
  const finishes = harness.trafficMessages.filter((m) => m.type === "traffic-finish");
  assert.equal(finishes.length, 2);
  for (const finish of finishes) {
    assert.equal(finish.response.body.length, 64 * 1024);
    assert.equal(finish.response.bodyTruncated, true);
  }
  const xhrStart = harness.trafficMessages.find((m) => m.entry?.source === "xhr");
  assert.equal(xhrStart?.entry.request.body.length, 64 * 1024);
});

test("只记录时请求体可晚于响应补报，并受相同预览上限约束", async () => {
  const harness = createContentScriptHarness("pass");
  enableCapture(harness, false);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const request = new Request("https://upload.test/api", { method: "POST", body, duplex: "half" } as RequestInit & { duplex: "half" });
  const response = await harness.fakeWindow.fetch(request);
  await flushTraffic();
  assert.equal(await response.text(), "ok");
  assert.equal(harness.trafficMessages.filter((m) => m.type === "traffic-finish").length, 1);
  assert.equal(harness.trafficMessages.some((m) => m.type === "traffic-request-body"), false);
  controller.enqueue(new TextEncoder().encode("x".repeat(70 * 1024)));
  controller.close();
  await flushTraffic();
  const patch = harness.trafficMessages.find((m) => m.type === "traffic-request-body");
  assert.equal(patch?.body?.length, 64 * 1024);
  assert.equal(patch?.bodyTruncated, true);
  assert.equal(harness.posted.length, 0);
  assert.equal((await harness.forwarded[0].text()).length, 70 * 1024);
});

test("fetch 发起时间不受请求体快照完成顺序影响", async () => {
  let time = 100;
  const harness = createContentScriptHarness("mock", { now: () => time });
  enableCapture(harness);
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const request = new Request("https://upload.test/first", { method: "POST", body, duplex: "half" } as RequestInit & { duplex: "half" });
  const first = harness.fakeWindow.fetch(request);
  time = 200;
  await harness.fakeWindow.fetch("https://upload.test/second");
  time = 300;
  controller.enqueue(new TextEncoder().encode("body"));
  controller.close();
  await first;
  const starts = harness.trafficMessages.filter((m) => m.type === "traffic-start");
  assert.equal(starts.find((m) => m.entry.request.url.endsWith("/first"))?.entry.startedAt, 1100);
  assert.equal(starts.find((m) => m.entry.request.url.endsWith("/second"))?.entry.startedAt, 1200);
});

test("XHR 取消或超时只结束一次记录，不触发真实请求", async () => {
  for (const kind of ["abort", "timeout"] as const) {
    const harness = createContentScriptHarness(kind === "timeout" ? "timeout" : "mock");
    enableCapture(harness);
    const xhr = new harness.fakeWindow.XMLHttpRequest();
    xhr.open("POST", "https://upload.test/api");
    if (kind === "timeout") xhr.timeout = 5;
    xhr.send("payload");
    if (kind === "abort") xhr.abort();
    await flushTraffic();
    const finishes = harness.trafficMessages.filter((m) => m.type === "traffic-finish");
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].error?.name, kind === "abort" ? "AbortError" : "TimeoutError");
    assert.equal(harness.cancelled.length, 1);
    assert.equal(harness.nativeXhrInstances[0].sentBodies.length, 0);
  }
});

test("XHR 重新打开结束旧记录，晚到的旧判定不会结束新请求", async () => {
  const harness = createContentScriptHarness("mock");
  enableCapture(harness);
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("POST", "https://upload.test/old");
  xhr.send("old");
  xhr.open("POST", "https://upload.test/new");
  xhr.send("new");
  await flushTraffic();
  const starts = harness.trafficMessages.filter((m) => m.type === "traffic-start");
  const finishes = harness.trafficMessages.filter((m) => m.type === "traffic-finish");
  assert.equal(finishes.length, 2);
  assert.equal(finishes[0].id, starts[0].entry.id);
  assert.equal(finishes[0].error?.name, "AbortError");
  assert.equal(finishes[1].id, starts[1].entry.id);
  assert.equal(finishes[1].decision, "mock");
});

test("已结束 XHR 的旧 loadend 不再读取原生响应或重复上报", () => {
  const harness = createContentScriptHarness("pass");
  enableCapture(harness, false);
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("GET", "https://upload.test/api");
  xhr.send();
  const target = harness.nativeXhrInstances[0] as any;
  Object.assign(target, { status: 200, responseText: "native", getAllResponseHeaders: () => "content-type: text/plain" });
  const finish = target.listeners.find((item: any) => item.type === "loadend").listener;
  finish(new Event("loadend"));
  Object.defineProperty(target, "responseText", { get() { throw new Error("旧响应已不可读"); } });
  assert.doesNotThrow(() => finish(new Event("loadend")));
  assert.equal(harness.trafficMessages.filter((m) => m.type === "traffic-finish").length, 1);
});

const mixedDecision = (type = "mock-with-real", fieldPaths = ["/data/imageUrl"]) => ({
  action: "transform", responseType: type, fieldPaths, status: 201, delayMs: 0,
  body: JSON.stringify({ data: { imageUrl: "expired", status: "MOCK" } }),
});
const realJson = { data: { imageUrl: "fresh", status: "REAL", extra: true } };

test("fetch 两类混合响应保留未选字段，只发一次原始请求并移除失效头", async () => {
  for (const type of ["real-overrides", "mock-with-real"]) {
    const harness = createContentScriptHarness("mock", {
      decision: mixedDecision(type, type === "real-overrides" ? ["/data/status"] : ["/data/imageUrl"]),
      nativeResponse: async () => new Response(JSON.stringify(realJson), { headers: { "content-type": "application/json", etag: "old", "content-length": "999", "content-encoding": "gzip" } }),
    });
    enableCapture(harness);
    const response = await harness.fakeWindow.fetch(new Request("https://upload.test/api", { method: "POST", body: "one-shot", credentials: "include" }));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), type === "real-overrides" ? { data: { ...realJson.data, status: "MOCK" } } : { data: { imageUrl: "fresh", status: "MOCK" } });
    assert.equal(response.headers.get("etag"), null);
    assert.equal(response.headers.get("content-length"), null);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(harness.forwarded.length, 1);
    assert.equal(harness.forwarded[0].credentials, "include");
    assert.equal(await harness.forwarded[0].text(), "one-shot");
    assert.equal(harness.trafficMessages.filter(m => m.type === "traffic-finish").length, 1);
  }
});

test("fetch 混合的网络、HTTP、JSON 和缺失字段错误均失败且不重发", async () => {
  for (const fail of ["network", "http", "json", "missing"]) {
    const harness = createContentScriptHarness("mock", {
      decision: mixedDecision(),
      nativeResponse: async () => {
        if (fail === "network") throw new Error("network failed");
        return new Response(fail === "json" ? "bad" : "{}", { status: fail === "http" ? 503 : 200, headers: { "content-type": "application/json" } });
      },
    });
    enableCapture(harness);
    await assert.rejects(harness.fakeWindow.fetch("https://upload.test/api"));
    assert.equal(harness.forwarded.length, 1);
    assert.ok(harness.trafficMessages.find(m => m.type === "traffic-finish")?.error);
  }
});

test("XHR 两类混合响应、JSON responseType、凭证和请求体保持一致", async () => {
  for (const type of ["real-overrides", "mock-with-real"]) {
    const harness = createContentScriptHarness("mock", { decision: mixedDecision(type, type === "real-overrides" ? ["/data/status"] : ["/data/imageUrl"]) });
    enableCapture(harness);
    const xhr = new harness.fakeWindow.XMLHttpRequest();
    xhr.open("POST", "https://upload.test/api");
    xhr.withCredentials = true;
    xhr.responseType = "json";
    const events: string[] = [];
    for (const name of ["load", "error", "loadend"]) xhr.addEventListener(name, () => events.push(name));
    xhr.send("one-shot");
    await flushTraffic();
    const target = harness.nativeXhrInstances[0] as any;
    assert.equal(target.withCredentials, true);
    assert.deepEqual(target.sentBodies, ["one-shot"]);
    Object.assign(target, { status: 200, responseText: JSON.stringify(realJson), getAllResponseHeaders: () => "content-type: application/json\r\netag: old\r\ncontent-length: 999" });
    for (const { listener } of [...target.listeners].filter(item => item.type === "load")) listener(new Event("load"));
    await flushTraffic();
    assert.equal(xhr.status, 201);
    assert.deepEqual(JSON.parse(JSON.stringify(xhr.response)), type === "real-overrides" ? { data: { ...realJson.data, status: "MOCK" } } : { data: { imageUrl: "fresh", status: "MOCK" } });
    assert.equal(xhr.getResponseHeader("etag"), null);
    assert.deepEqual(events, ["load", "loadend"]);
    assert.equal(target.sentBodies.length, 1);
  }
});

test("XHR 混合失败只报告 error，取消、超时和重新 open 会中止旧真实请求", async () => {
  for (const action of ["error", "missing", "abort", "timeout", "reopen"]) {
    const harness = createContentScriptHarness("mock", { decision: mixedDecision() });
    enableCapture(harness);
    const xhr = new harness.fakeWindow.XMLHttpRequest();
    xhr.open("POST", "https://upload.test/api");
    if (action === "timeout") xhr.timeout = 30;
    const events: string[] = [];
    for (const name of ["load", "error", "abort", "timeout", "loadend"]) xhr.addEventListener(name, () => events.push(name));
    xhr.send("once");
    await flushTraffic();
    const target = harness.nativeXhrInstances[0] as any;
    if (action === "abort") xhr.abort();
    else if (action === "reopen") xhr.open("GET", "https://upload.test/other");
    else if (action !== "timeout") {
      Object.assign(target, { status: 200, responseText: "{}", getAllResponseHeaders: () => "content-type: application/json" });
      for (const { listener } of [...target.listeners].filter(item => item.type === (action === "missing" ? "load" : "error"))) listener(new Event(action === "missing" ? "load" : "error"));
    }
    await new Promise(resolve => setTimeout(resolve, action === "timeout" ? 40 : 10));
    assert.equal(target.sentBodies.length, 1);
    if (["abort", "timeout", "reopen"].includes(action)) assert.equal(target.aborted, true);
    assert.equal(events.includes("load"), false);
    if (action === "error" || action === "missing") assert.deepEqual(events, ["error", "loadend"]);
    if (action === "timeout") assert.deepEqual(events, ["timeout", "loadend"]);
    assert.equal(harness.trafficMessages.filter(m => m.type === "traffic-finish").length, 1);
  }
});

test("同一 XHR 从放行切换混合，不提前暴露原响应或重复调用原生监听器", async () => {
  const options: { decision: unknown } = { decision: { action: "pass" } };
  const harness = createContentScriptHarness("pass", options);
  enableCapture(harness);
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("GET", "https://upload.test/api");
  xhr.send();
  await flushTraffic();
  let handlers = 0, listeners = 0;
  xhr.onload = () => handlers++;
  xhr.addEventListener("load", () => listeners++);
  const target = harness.nativeXhrInstances[0] as any;
  target.onload(new Event("load"));
  for (const { listener } of [...target.listeners].filter(item => item.type === "load")) listener(new Event("load"));
  assert.equal(handlers, 1); assert.equal(listeners, 1);
  options.decision = mixedDecision();
  xhr.open("GET", "https://upload.test/api");
  xhr.send();
  await flushTraffic();
  assert.equal(target.onload, null);
  Object.assign(target, { status: 200, responseText: JSON.stringify(realJson), getAllResponseHeaders: () => "content-type: application/json" });
  for (const { listener } of [...target.listeners].filter(item => item.type === "load")) listener(new Event("load"));
  assert.equal(handlers, 1); assert.equal(listeners, 1);
  await flushTraffic();
  assert.equal(handlers, 2); assert.equal(listeners, 2);
  assert.equal(JSON.parse(xhr.responseText).data.imageUrl, "fresh");
});

test("XHR 放行转混合时 once 和 AbortSignal 监听器不会复活", async () => {
  const options: { decision: unknown } = { decision: { action: "pass" } };
  const harness = createContentScriptHarness("pass", options);
  enableCapture(harness);
  const xhr = new harness.fakeWindow.XMLHttpRequest();
  xhr.open("GET", "https://upload.test/api"); xhr.send();
  await flushTraffic();
  let once = 0, aborted = 0;
  const controller = new AbortController();
  xhr.addEventListener("load", () => once++, { once: true });
  xhr.addEventListener("load", () => aborted++, { signal: controller.signal });
  controller.abort();
  const target = harness.nativeXhrInstances[0] as any;
  target.dispatch("load");
  assert.equal(once, 1); assert.equal(aborted, 0);
  options.decision = mixedDecision();
  xhr.open("GET", "https://upload.test/api"); xhr.send();
  await flushTraffic();
  Object.assign(target, { status: 200, responseText: JSON.stringify(realJson), getAllResponseHeaders: () => "content-type: application/json" });
  target.dispatch("load");
  await flushTraffic();
  assert.equal(once, 1); assert.equal(aborted, 0);
});

test("观测上报失败不会改变 fetch 的响应或真实网络失败", async () => {
  for (const fail of [false, true]) {
    const harness = createContentScriptHarness("pass", { nativeResponse: async () => {
      if (fail) throw new Error("network failed");
      return new Response("native");
    } });
    enableCapture(harness, false);
    const postMessage = harness.fakeWindow.postMessage;
    harness.fakeWindow.postMessage = (message: { type: string }) => {
      if (message.type.startsWith("traffic-")) throw new Error("面板不可用");
      postMessage(message);
    };
    const response = harness.fakeWindow.fetch("https://upload.test/api");
    if (fail) await assert.rejects(response, /network failed/);
    else assert.equal(await (await response).text(), "native");
  }
});
