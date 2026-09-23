import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { RESOLVE_TIMEOUT_MS } from "./protocol.js";
import type { ExtensionRuntimeRequest } from "@mock-json/extension-contract";

const source = readFileSync(new URL("./content-main.ts", import.meta.url), "utf8");
const compiledSource = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText.replace(/\nexport \{\};?\s*$/, "\n");

function createContentScriptHarness(mode: "pass" | "throw" | "timeout" | "mock") {
  const forwarded: Request[] = [];
  const posted: ExtensionRuntimeRequest[] = [];
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
    send(_body?: unknown) {}
    setRequestHeader(_name: string, _value: string) {}
    abort() {}
    addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) {
      this.listeners.push({ type, listener, options });
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
      return Promise.resolve();
    },
    XMLHttpRequest: NativeXMLHttpRequest,
    location: { hostname: "upload.test", port: "443", href: "https://upload.test/" },
    addEventListener(type: string, listener: (event: { source: unknown; data: unknown }) => void) {
      if (type === "message") messageListeners.push(listener);
    },
    postMessage(message: { type?: string; id?: string; request?: ExtensionRuntimeRequest }) {
      if (message.type === "monitoring-state-request") return;
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
              result: mode === "mock"
                ? { action: "mock", status: 200, delayMs: 0, body: "{}", headers: { "content-type": "application/json" } }
                : { action: "pass" },
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
    Request,
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
  };
  new Script(compiledSource).runInNewContext(sandbox);
  const messageListener = messageListeners[0];
  assert.ok(messageListener);
  return { fakeWindow, forwarded, posted, messageListener, originalFetch, originalXMLHttpRequest, nativeXhrInstances };
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

test("MAIN world content script stays self-contained", () => {
  assert.doesNotMatch(source, /^import(?!\s+type\b)/m);
  assert.doesNotMatch(source, /^export\b/m);
});

test("resolver timeout and invalid responses fail open without an unhandled action access", () => {
  assert.equal(RESOLVE_TIMEOUT_MS, 1000);
  assert.match(source, /const CONTENT_RESOLVE_TIMEOUT_MS = 1200/);
  assert.match(source, /resolve\(isRuntimeResponse\(result\)/);
  assert.match(source, /\.catch\(\(\) =>/);
});

test("MAIN world avoids resolver work when monitoring is inactive and propagates cancellation", () => {
  const fastPath = source.indexOf("monitoringWhitelist.length === 0");
  const requestConstruction = source.indexOf("const request = new Request");
  assert.ok(fastPath >= 0 && fastPath < requestConstruction);
  assert.match(source, /type: "cancel"/);
  assert.match(source, /askResolver\(withLogBody\(request\), state\.mockAbortController\.signal\)/);
  assert.match(source, /waitForDelay\(decision\.delayMs, state\.mockAbortController\.signal\)/);
});

test("fetch native fallbacks reuse the inspected Request to preserve one-shot upload bodies", () => {
  const requestConstruction = source.indexOf("const request = new Request");
  const resolver = source.indexOf("function askResolver", requestConstruction);
  assert.ok(requestConstruction >= 0 && resolver > requestConstruction);
  const inspectedFetchCode = source.slice(requestConstruction, resolver);
  assert.doesNotMatch(inspectedFetchCode, /nativeFetch\(input, init\)/);
  assert.match(inspectedFetchCode, /nativeFetch\(request\)/);
});

test("native fetch and XMLHttpRequest stay untouched before monitoring is enabled", () => {
  const harness = createContentScriptHarness("pass");
  assert.equal(harness.fakeWindow.fetch, harness.originalFetch);
  assert.equal(harness.fakeWindow.XMLHttpRequest, harness.originalXMLHttpRequest);
});

test("XHR stays native on a page whose own origin is outside the whitelist", () => {
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
  assert.equal(harness.fakeWindow.XMLHttpRequest, harness.originalXMLHttpRequest);
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

test("non-whitelisted fetch keeps the original Request untouched", async () => {
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
  const forwarded = await runForwardedFetch("pass", original);
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
