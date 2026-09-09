import type {
  ExtensionRuntimeRequest,
  ExtensionRuntimeResponse,
} from "../../mock-console/shared/types.js";
import { urlMatchesWhitelist } from "./domain-whitelist.js";

const CHANNEL = "__mock_console_extension_v1";
const MONITORING_STATE_TYPE = "monitoring-state";
const RESOLVE_TIMEOUT_MS = 200;

type MonitoringStateWindowMessage = {
  channel: typeof CHANNEL;
  type: typeof MONITORING_STATE_TYPE;
  enabled: boolean;
  whitelist: string[];
};

type ResolveResultMessage = {
  channel: typeof CHANNEL;
  type: "resolve-result";
  id: string;
  result: ExtensionRuntimeResponse;
};

const nativeFetch = window.fetch.bind(window);
const NativeXMLHttpRequest = window.XMLHttpRequest;
const pendingResolutions = new Map<string, (result: ExtensionRuntimeResponse) => void>();
let nextRequestId = 0;
let monitoringEnabled = false;
let monitoringWhitelist: string[] = [];

if (!isMockConsolePage()) {
  installFetchInterceptor();
  installXhrInterceptor();
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (isMonitoringStateWindowMessage(event.data)) {
    monitoringEnabled = event.data.enabled;
    monitoringWhitelist = event.data.whitelist;
    return;
  }
  if (!isResolveResultMessage(event.data)) return;
  const resolve = pendingResolutions.get(event.data.id);
  if (!resolve) return;
  pendingResolutions.delete(event.data.id);
  resolve(event.data.result);
});

function installFetchInterceptor() {
  window.fetch = (async function interceptedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = new Request(input, init);
    if (!monitoringEnabled || !isWhitelistedUrl(request.url)) return nativeFetch(input, init);

    const decision = await askResolver({
      url: request.url,
      method: request.method,
      headers: headersToRecord(request.headers),
    }, request.signal);
    if (!monitoringEnabled || !isWhitelistedUrl(request.url) || decision.action === "pass") return nativeFetch(input, init);

    try {
      await waitForDelay(decision.delayMs, request.signal);
      if (request.signal.aborted) throw abortError();
      const body = [204, 205, 304].includes(decision.status) ? null : decision.body;
      return new Response(body, { status: decision.status, headers: decision.headers });
    } catch (error) {
      if (isAbortError(error)) throw error;
      // A malformed local decision must not turn a working browser request into a failure.
      return nativeFetch(input, init);
    }
  }) as typeof window.fetch;
}

function askResolver(request: ExtensionRuntimeRequest, signal?: AbortSignal): Promise<ExtensionRuntimeResponse> {
  if (signal?.aborted) return Promise.resolve({ action: "pass", reason: "invalid-request" });

  return new Promise((resolve) => {
    const id = `${Date.now().toString(36)}-${nextRequestId++}`;
    let settled = false;
    const timer = window.setTimeout(() => settle({ action: "pass", reason: "invalid-request" }), RESOLVE_TIMEOUT_MS);
    const onAbort = () => settle({ action: "pass", reason: "invalid-request" });
    const settle = (result: ExtensionRuntimeResponse) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      pendingResolutions.delete(id);
      resolve(result);
    };

    pendingResolutions.set(id, settle);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      window.postMessage({ channel: CHANNEL, type: "resolve", id, request }, "*");
    } catch {
      settle({ action: "pass", reason: "invalid-request" });
    }
  });
}

function waitForDelay(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortError());
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function installXhrInterceptor() {
  function MockAwareXMLHttpRequest(this: unknown) {
    const target = new NativeXMLHttpRequest();
    let proxy: XMLHttpRequest;
    const state: XhrState = {
      target,
      proxy: undefined as unknown as XMLHttpRequest,
      mode: "unopened",
      method: "GET",
      url: "",
      openArgs: [],
      async: true,
      opened: false,
      sent: false,
      aborted: false,
      finished: false,
      generation: 0,
      readyState: 0,
      timeout: 0,
      withCredentials: false,
      responseType: "",
      requestHeaders: {},
      handlers: new Map(),
      listeners: [],
    };

    proxy = new Proxy(target, createXhrHandler(state));
    state.proxy = proxy;
    return proxy;
  }

  MockAwareXMLHttpRequest.prototype = NativeXMLHttpRequest.prototype;
  Object.defineProperties(MockAwareXMLHttpRequest, {
    UNSENT: { value: NativeXMLHttpRequest.UNSENT },
    OPENED: { value: NativeXMLHttpRequest.OPENED },
    HEADERS_RECEIVED: { value: NativeXMLHttpRequest.HEADERS_RECEIVED },
    LOADING: { value: NativeXMLHttpRequest.LOADING },
    DONE: { value: NativeXMLHttpRequest.DONE },
  });
  window.XMLHttpRequest = MockAwareXMLHttpRequest as unknown as typeof XMLHttpRequest;
}

type XhrMode = "unopened" | "pending" | "direct" | "mock";
type XhrListener = {
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
};
type XhrState = {
  target: XMLHttpRequest;
  proxy: XMLHttpRequest;
  mode: XhrMode;
  method: string;
  url: string;
  openArgs: unknown[];
  async: boolean;
  opened: boolean;
  sent: boolean;
  aborted: boolean;
  finished: boolean;
  generation: number;
  readyState: number;
  timeout: number;
  withCredentials: boolean;
  responseType: XMLHttpRequestResponseType;
  requestHeaders: Record<string, string>;
  handlers: Map<string, EventListenerOrEventListenerObject | null>;
  listeners: XhrListener[];
  mock?: Extract<ExtensionRuntimeResponse, { action: "mock" }>;
  timeoutTimer?: number;
};

function createXhrHandler(state: XhrState): ProxyHandler<XMLHttpRequest> {
  return {
    get(target, property) {
      if (typeof property === "string") {
        if (property === "open") return (...args: unknown[]) => openXhr(state, args);
        if (property === "setRequestHeader") return (name: string, value: string) => setRequestHeader(state, name, value);
        if (property === "send") return (body?: Document | XMLHttpRequestBodyInit | null) => sendXhr(state, body);
        if (property === "abort") return () => abortXhr(state);
        if (property === "addEventListener") return (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => addXhrListener(state, type, listener, options);
        if (property === "removeEventListener") return (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => removeXhrListener(state, type, listener, options);
        if (property.startsWith("on")) return state.handlers.get(property) ?? null;
        if (property === "readyState") return state.mode === "direct" ? target.readyState : state.readyState;
        if (property === "status") return state.mode === "direct" ? target.status : state.mock?.status || 0;
        if (property === "statusText") return state.mode === "direct" ? target.statusText : state.mock ? String(state.mock.status) : "";
        if (property === "responseURL") return state.mode === "direct" ? target.responseURL : state.url;
        if (property === "responseType") return state.mode === "direct" ? target.responseType : state.responseType;
        if (property === "timeout") return state.mode === "direct" ? target.timeout : state.timeout;
        if (property === "withCredentials") return state.mode === "direct" ? target.withCredentials : state.withCredentials;
        if (property === "response") return state.mode === "direct" ? target.response : mockResponse(state);
        if (property === "responseText") return state.mode === "direct" ? target.responseText : state.mock ? state.mock.body : "";
        if (property === "responseXML") return state.mode === "direct" ? target.responseXML : null;
        if (property === "getAllResponseHeaders") return () => getAllResponseHeaders(state);
        if (property === "getResponseHeader") return (name: string) => getResponseHeader(state, name);
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (typeof property === "string" && property.startsWith("on")) {
        state.handlers.set(property, value);
        if (state.mode === "direct") Reflect.set(target, property, value, target);
        return true;
      }
      if (property === "timeout") {
        state.timeout = Number(value) || 0;
        if (state.mode === "direct") Reflect.set(target, property, state.timeout, target);
        return true;
      }
      if (property === "withCredentials") {
        state.withCredentials = Boolean(value);
        if (state.mode === "direct") Reflect.set(target, property, state.withCredentials, target);
        return true;
      }
      if (property === "responseType") {
        state.responseType = String(value) as XMLHttpRequestResponseType;
        if (state.mode === "direct") Reflect.set(target, property, state.responseType, target);
        return true;
      }
      return Reflect.set(target, property, value, target);
    },
  };
}

function openXhr(state: XhrState, args: unknown[]) {
  if (args.length < 2) throw new TypeError("XMLHttpRequest.open requires a method and URL");
  const method = String(args[0]);
  const rawUrl = String(args[1]);
  const async = args[2] !== false;
  resetXhr(state);
  state.method = method;
  state.async = async;
  state.openArgs = args;
  state.opened = true;

  let url: URL;
  try {
    url = new URL(rawUrl, window.location.href);
  } catch {
    state.mode = "direct";
    state.target.open(...args as [string, string, boolean, string?, string?]);
    installNativeListeners(state);
    return;
  }
  if (!monitoringEnabled || !urlMatchesWhitelist(url.href, monitoringWhitelist) || !async || !isHttpUrl(url.href)) {
    state.mode = "direct";
    state.target.open(...args as [string, string, boolean, string?, string?]);
    installNativeListeners(state);
    return;
  }

  state.mode = "pending";
  state.url = url.href;
  state.readyState = XMLHttpRequest.OPENED;
  emitXhrEvent(state, "readystatechange");
}

function setRequestHeader(state: XhrState, name: string, value: string) {
  if (state.mode === "direct") return state.target.setRequestHeader(name, value);
  if (!state.opened || state.sent) throw new DOMException("Invalid XMLHttpRequest state", "InvalidStateError");
  const previous = state.requestHeaders[name];
  state.requestHeaders[name] = previous ? `${previous}, ${value}` : value;
}

function sendXhr(state: XhrState, body?: Document | XMLHttpRequestBodyInit | null) {
  if (state.mode === "direct") return state.target.send(body);
  if (!state.opened || state.sent) throw new DOMException("Invalid XMLHttpRequest state", "InvalidStateError");
  if (!monitoringEnabled || !urlMatchesWhitelist(state.url, monitoringWhitelist)) return useDirectXhr(state, body);
  state.sent = true;
  const generation = state.generation;
  if (state.timeout > 0) state.timeoutTimer = window.setTimeout(() => timeoutXhr(state, generation), state.timeout);

  const request: ExtensionRuntimeRequest = {
    url: state.url,
    method: state.method.toUpperCase(),
    headers: { ...state.requestHeaders },
  };
  void askResolver(request).then((decision) => {
    if (state.generation !== generation || state.aborted || state.finished) return;
    if (decision.action === "pass") return useDirectXhr(state, body);
    void useMockXhr(state, decision, generation);
  });
}

function useDirectXhr(state: XhrState, body?: Document | XMLHttpRequestBodyInit | null) {
  if (state.aborted || state.finished) return;
  clearXhrTimeout(state);
  state.mode = "direct";
  installNativeListeners(state);
  state.target.open(...state.openArgs as [string, string, boolean, string?, string?]);
  state.target.timeout = state.timeout;
  state.target.withCredentials = state.withCredentials;
  if (state.responseType) state.target.responseType = state.responseType;
  for (const [name, value] of Object.entries(state.requestHeaders)) state.target.setRequestHeader(name, value);
  state.target.send(body);
}

async function useMockXhr(
  state: XhrState,
  decision: Extract<ExtensionRuntimeResponse, { action: "mock" }>,
  generation: number,
) {
  await sleep(decision.delayMs);
  if (state.generation !== generation || state.aborted || state.finished) return;
  clearXhrTimeout(state);
  state.mode = "mock";
  state.mock = decision;
  state.readyState = XMLHttpRequest.HEADERS_RECEIVED;
  emitXhrEvent(state, "readystatechange");
  state.readyState = XMLHttpRequest.LOADING;
  emitXhrEvent(state, "readystatechange");
  state.readyState = XMLHttpRequest.DONE;
  state.finished = true;
  emitXhrEvent(state, "readystatechange");
  emitXhrEvent(state, "load");
  emitXhrEvent(state, "loadend");
}

function abortXhr(state: XhrState) {
  if (state.mode === "direct") return state.target.abort();
  if (!state.sent || state.finished) return;
  state.aborted = true;
  clearXhrTimeout(state);
  state.readyState = XMLHttpRequest.DONE;
  state.finished = true;
  emitXhrEvent(state, "abort");
  emitXhrEvent(state, "loadend");
}

function timeoutXhr(state: XhrState, generation: number) {
  if (state.generation !== generation || state.mode !== "pending" || state.finished) return;
  state.finished = true;
  state.mode = "mock";
  state.readyState = XMLHttpRequest.DONE;
  emitXhrEvent(state, "readystatechange");
  emitXhrEvent(state, "timeout");
  emitXhrEvent(state, "loadend");
}

function resetXhr(state: XhrState) {
  clearXhrTimeout(state);
  state.generation += 1;
  state.mode = "unopened";
  state.url = "";
  state.openArgs = [];
  state.opened = false;
  state.sent = false;
  state.aborted = false;
  state.finished = false;
  state.readyState = XMLHttpRequest.UNSENT;
  state.requestHeaders = {};
  state.mock = undefined;
}

function installNativeListeners(state: XhrState) {
  for (const [property, handler] of state.handlers) Reflect.set(state.target, property, handler, state.target);
  for (const { type, listener, options } of state.listeners) state.target.addEventListener(type, listener, options);
}

function addXhrListener(state: XhrState, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
  if (state.mode === "direct") return state.target.addEventListener(type, listener, options);
  state.listeners.push({ type, listener, options });
}

function removeXhrListener(state: XhrState, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
  if (state.mode === "direct") return state.target.removeEventListener(type, listener, options);
  state.listeners = state.listeners.filter((item) => item.type !== type || item.listener !== listener || sameListenerOptions(item.options, options));
}

function emitXhrEvent(state: XhrState, type: string) {
  const event = new Event(type);
  for (const { type: listenerType, listener } of state.listeners) {
    if (listenerType === type) invokeListener(listener, event, state.proxy);
  }
  const handler = state.handlers.get(`on${type}`);
  if (handler) invokeListener(handler, event, state.proxy);
}

function invokeListener(listener: EventListenerOrEventListenerObject, event: Event, target: XMLHttpRequest) {
  if (typeof listener === "function") listener.call(target, event);
  else listener.handleEvent.call(target, event);
}

function sameListenerOptions(left: boolean | AddEventListenerOptions | undefined, right: boolean | EventListenerOptions | undefined) {
  const leftCapture = typeof left === "boolean" ? left : Boolean(left?.capture);
  const rightCapture = typeof right === "boolean" ? right : Boolean(right?.capture);
  return leftCapture === rightCapture;
}

function mockResponse(state: XhrState) {
  if (!state.mock) return null;
  if (state.responseType === "json") {
    try { return JSON.parse(state.mock.body) as unknown; } catch { return null; }
  }
  if (state.responseType === "blob") return new Blob([state.mock.body], { type: state.mock.headers["content-type"] || "application/json" });
  if (state.responseType === "arraybuffer") return new TextEncoder().encode(state.mock.body).buffer;
  return state.mock.body;
}

function getAllResponseHeaders(state: XhrState) {
  if (state.mode === "direct") return state.target.getAllResponseHeaders();
  if (!state.mock) return "";
  return Object.entries(state.mock.headers).map(([name, value]) => `${name}: ${value}\r\n`).join("");
}

function getResponseHeader(state: XhrState, name: string) {
  if (state.mode === "direct") return state.target.getResponseHeader(name);
  const entry = Object.entries(state.mock?.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] || null;
}

function clearXhrTimeout(state: XhrState) {
  if (state.timeoutTimer === undefined) return;
  window.clearTimeout(state.timeoutTimer);
  state.timeoutTimer = undefined;
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isMonitoringStateWindowMessage(value: unknown): value is MonitoringStateWindowMessage {
  return isRecord(value) && value.channel === CHANNEL && value.type === MONITORING_STATE_TYPE && typeof value.enabled === "boolean";
}

function isResolveResultMessage(value: unknown): value is ResolveResultMessage {
  if (!isRecord(value) || value.channel !== CHANNEL || value.type !== "resolve-result" || typeof value.id !== "string") return false;
  const result = value.result;
  if (!isRecord(result) || (result.action !== "mock" && result.action !== "pass")) return false;
  if (result.action === "pass") return true;
  return (
    typeof result.status === "number" && Number.isInteger(result.status) && result.status >= 200 && result.status <= 599 &&
    typeof result.delayMs === "number" && Number.isInteger(result.delayMs) && result.delayMs >= 0 && result.delayMs <= 30000 &&
    typeof result.body === "string" && isRecord(result.headers) && Object.values(result.headers).every((header) => typeof header === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headersToRecord(headers: Headers) {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => { result[name] = value; });
  return result;
}

function isWhitelistedUrl(value: string) {
  if (!isHttpUrl(value)) return false;
  try {
    return urlMatchesWhitelist(new URL(value, window.location.href).href, monitoringWhitelist);
  } catch {
    return false;
  }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isMockConsolePage() {
  const hostname = window.location.hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") return false;
  return window.location.port === "22333" || window.location.port === "22334";
}
