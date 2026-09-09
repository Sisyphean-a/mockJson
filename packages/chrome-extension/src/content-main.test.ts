import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { RESOLVE_TIMEOUT_MS } from "./protocol.js";

const source = readFileSync(new URL("./content-main.ts", import.meta.url), "utf8");
const compiledSource = transpileModule(source, {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
}).outputText.replace(/\nexport \{\};?\s*$/, "\n");

function createContentScriptHarness(mode: "pass" | "throw" | "timeout") {
  const forwarded: Request[] = [];
  const messageListeners: Array<(event: { source: unknown; data: unknown }) => void> = [];
  const NativeXMLHttpRequest = class {};
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
    postMessage(message: { type?: string; id?: string }) {
      if (message.type === "monitoring-state-request") return;
      if (message.type !== "resolve") return;
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
              result: { action: "pass" },
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
    Blob,
    FormData,
    ReadableStream,
    TextEncoder,
    URL,
    XMLHttpRequest: NativeXMLHttpRequest,
    setTimeout,
    clearTimeout,
    queueMicrotask,
  };
  new Script(compiledSource).runInNewContext(sandbox);
  const messageListener = messageListeners[0];
  assert.ok(messageListener);
  return { fakeWindow, forwarded, messageListener, originalFetch, originalXMLHttpRequest };
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
  assert.match(source, /askResolver\(request, state\.mockAbortController\.signal\)/);
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
