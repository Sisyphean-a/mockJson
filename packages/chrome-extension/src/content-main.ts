import { composeResponse, composedHeaders } from "@mock-json/extension-contract/response-fields";
import type {
  ExtensionPassReason,
  ExtensionRuntimeRequest,
  ExtensionRuntimeResponse,
} from "@mock-json/extension-contract";
import type {
  TrafficBodyInfo,
  TrafficFinishMessage,
  TrafficRequestBodyMessage,
  TrafficRequestSnapshot,
  TrafficStartMessage,
  TrafficWindowMessage,
} from "./protocol.js";

// MAIN world 内容脚本必须自包含，不能依赖 Vite 生成的共享 chunk；Chrome 会按普通脚本解析它。
const CHANNEL = "__mock_console_extension_v1";
const MONITORING_STATE_TYPE = "monitoring-state";
const MONITORING_STATE_REQUEST_TYPE = "monitoring-state-request";
const TRAFFIC_START_TYPE = "traffic-start";
const TRAFFIC_REQUEST_BODY_TYPE = "traffic-request-body";
const TRAFFIC_FINISH_TYPE = "traffic-finish";
// Rule: 面板只保留可读预览，超过上限的文本截断显示，不阻塞页面请求。
const TRAFFIC_BODY_LIMIT = 64 * 1024;
// Flow: 页面层比 Service Worker 的 1 秒超时多等 200ms，覆盖消息往返延迟。
const CONTENT_RESOLVE_TIMEOUT_MS = 1200;

type MonitoringStateWindowMessage = {
  channel: typeof CHANNEL;
  type: typeof MONITORING_STATE_TYPE;
  enabled: boolean;
  capture?: boolean;
  whitelist: string[];
};

type ResolveResultMessage = {
  channel: typeof CHANNEL;
  type: "resolve-result";
  id: string;
  result: ExtensionRuntimeResponse;
};

type ResolveCancelMessage = {
  channel: typeof CHANNEL;
  type: "cancel";
  id: string;
};

const originalFetch = window.fetch;
const nativeFetch = originalFetch.bind(window);
const NativeXMLHttpRequest = window.XMLHttpRequest;
const pendingResolutions = new Map<string, (result: unknown) => void>();
const requestIdPrefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let nextRequestId = 0;
let nextTrafficId = 0;
let monitoringEnabled = false;
let captureEnabled = false;
let monitoringWhitelist: string[] = [];
let interceptedFetch: typeof window.fetch | undefined;
let interceptedXMLHttpRequest: typeof XMLHttpRequest | undefined;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (isMonitoringStateWindowMessage(event.data)) {
    monitoringEnabled = event.data.enabled;
    captureEnabled = event.data.capture === true;
    monitoringWhitelist = event.data.whitelist;
    updateInterceptors();
    return;
  }
  if (!isResolveResultMessage(event.data)) return;
  const resolve = pendingResolutions.get(event.data.id);
  if (!resolve) return;
  pendingResolutions.delete(event.data.id);
  resolve(event.data.result);
});

if (!isMockConsolePage()) {
  window.postMessage({ channel: CHANNEL, type: MONITORING_STATE_REQUEST_TYPE }, "*");
}

function updateInterceptors() {
  if (isMockConsolePage()) return;
  const shouldIntercept = isMonitoringActive() || isCaptureActive();
  if (shouldIntercept) installFetchInterceptor();
  else if (interceptedFetch && window.fetch === interceptedFetch) window.fetch = originalFetch;

  // Guarantee: 未显式开启“只记录”时，非白名单页面不替换任何请求 API，避免改变第三方页面可观察的函数和实例语义。
  if (shouldIntercept) installXhrInterceptor();
  else if (interceptedXMLHttpRequest && window.XMLHttpRequest === interceptedXMLHttpRequest)
    window.XMLHttpRequest = NativeXMLHttpRequest;
}

function installFetchInterceptor() {
  if (interceptedFetch) {
    window.fetch = interceptedFetch;
    return;
  }
  const fetchInterceptor = (async function interceptedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const mockActive = isMonitoringActive();
    if (!mockActive && !isCaptureActive()) return nativeFetch(input, init);
    // Guarantee: 进入观测后复用唯一 Request，保留一次性请求体；记录失败只能影响面板，不能改变页面请求结果。
    const url = getRequestUrl(input);
    if (!url || !isHttpUrl(url)) return nativeFetch(input, init);
    const request = new Request(input, init);
    const baseRequest = { url: request.url, method: request.method, headers: headersToRecord(request.headers) };
    if (isBinaryRequest(request)) {
      const traffic = new RequestTraffic("fetch", { ...baseRequest, bodyUnavailable: "binary" }, "capture");
      return forwardFetchWithTraffic(request, traffic);
    }

    const startedAt = currentTime();
    if (!mockActive) {
      const traffic = new RequestTraffic("fetch", baseRequest, "capture", startedAt);
      // Flow: 只记录不等待快照，原生请求立即发出，读取完成后补报请求体。
      void readRequestBodyForLog(request).then((body) => traffic.requestBody(body)).catch(() => undefined);
      return forwardFetchWithTraffic(request, traffic);
    }

    const description: ExtensionRuntimeRequest = { ...baseRequest };
    try {
      Object.assign(description, await readRequestBodyForLog(request));
    } catch {
      // Failure: 请求体快照失败不影响判定与放行。
    }
    const traffic = new RequestTraffic("fetch", description, "pending", startedAt);
    let decision: ExtensionRuntimeResponse;
    try {
      decision = await askResolver(withLogBody(description), request.signal);
    } catch {
      decision = { action: "pass", reason: "invalid-request" };
    }
    if (!isMonitoringActive() || decision.action === "pass") {
      traffic.pass(decision.action === "pass" ? decision.reason : undefined);
      return forwardFetchWithTraffic(request, traffic);
    }

    if (decision.action === "transform") return transformFetch(request, traffic, decision);
    try {
      await waitForDelay(decision.delayMs, request.signal);
      if (request.signal.aborted) throw abortError();
      const body = [204, 205, 304].includes(decision.status) ? null : decision.body;
      const response = new Response(body, { status: decision.status, headers: decision.headers });
      traffic.finish({ decision: "mock", response: {
        status: decision.status,
        statusText: response.statusText,
        headers: decision.headers,
        mimeType: decision.headers["content-type"],
        body: body ?? undefined,
      } });
      return response;
    } catch (error) {
      if (isAbortError(error)) {
        traffic.finish({ decision: "mock", error: describeError(error) });
        throw error;
      }
      // Failure: 本地判定无效时保持浏览器原生请求，不把扩展错误变成页面请求失败。
      traffic.pass();
      return forwardFetchWithTraffic(request, traffic);
    }
  }) as typeof window.fetch;
  interceptedFetch = fetchInterceptor;
  window.fetch = interceptedFetch;
}

async function transformFetch(request: Request, traffic: RequestTraffic, decision: Extract<ExtensionRuntimeResponse, { action: "transform" }>) {
  try {
    // Guarantee: 只发一次真实请求；组合失败绝不进入完整 Mock 的原生重发分支。
    const real = await nativeFetch(request);
    if (!real.ok) throw new Error(`真实接口返回 HTTP ${real.status}`);
    if (request.method === "HEAD" || !/json/i.test(real.headers.get("content-type") ?? "")) throw new Error("混合响应需要真实 JSON 响应");
    const body = JSON.stringify(composeResponse(decision.responseType, JSON.parse(decision.body), await real.json(), decision.fieldPaths));
    await waitForDelay(decision.delayMs, request.signal);
    if (request.signal.aborted) throw abortError();
    const headers = composedHeaders(headersToRecord(real.headers));
    const response = new Response(body, { status: decision.status, headers });
    Object.defineProperties(response, { url: { value: real.url }, redirected: { value: real.redirected }, type: { value: real.type } });
    traffic.finish({ decision: "mock", response: { status: decision.status, statusText: response.statusText, headers, mimeType: headers["content-type"], body } });
    return response;
  } catch (error) {
    traffic.finish({ decision: "mock", error: describeError(error) });
    throw error;
  }
}

async function forwardFetchWithTraffic(request: Request, traffic: RequestTraffic) {
  try {
    const response = await nativeFetch(request);
    void finishFetchTraffic(traffic, response);
    return response;
  } catch (error) {
    traffic.finish({ error: describeError(error) });
    throw error;
  }
}

async function finishFetchTraffic(traffic: RequestTraffic, response: Response) {
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length"));
  const snapshot: NonNullable<TrafficFinishMessage["response"]> = {
    status: response.status,
    statusText: response.statusText,
    headers: headersToRecord(response.headers),
    ...(contentType ? { mimeType: contentType } : {}),
    ...(Number.isFinite(contentLength) && contentLength >= 0 ? { size: contentLength } : {}),
  };
  if (response.type === "opaque" || response.type === "opaqueredirect") snapshot.bodyUnavailable = "unavailable";
  else if (/^text\/event-stream/i.test(contentType)) snapshot.bodyUnavailable = "unavailable";
  else if (isBinaryContentType(contentType)) snapshot.bodyUnavailable = "binary";
  else {
    try {
      Object.assign(snapshot, await readResponseBodyInfo(response));
    } catch {
      snapshot.bodyUnavailable = "unavailable";
    }
  }
  traffic.finish({ response: snapshot });
}

async function readResponseBodyInfo(response: Response): Promise<TrafficBodyInfo> {
  let clone: Response;
  try {
    clone = response.clone();
  } catch {
    return { bodyUnavailable: "unavailable" };
  }
  const reader = clone.body?.getReader();
  if (!reader) return { body: "" };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (size + value.byteLength > TRAFFIC_BODY_LIMIT) {
        const remaining = TRAFFIC_BODY_LIMIT - size;
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
          size += remaining;
        }
        truncated = true;
        void reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } catch {
    return { bodyUnavailable: "unavailable" };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(bytes), ...(truncated ? { bodyTruncated: true } : {}) };
}

function currentTime() {
  const perf = typeof performance === "object" && typeof performance.timeOrigin === "number" ? performance : undefined;
  return perf ? perf.timeOrigin + perf.now() : Date.now();
}

function createTrafficId(source: "fetch" | "xhr") {
  return `${source}-${requestIdPrefix}-${nextTrafficId++}`;
}

function createBodyInfo(value: string | undefined): TrafficBodyInfo {
  if (value === undefined) return {};
  if (value.length <= TRAFFIC_BODY_LIMIT) return { body: value };
  return { body: value.slice(0, TRAFFIC_BODY_LIMIT), bodyTruncated: true };
}

function requestSnapshot(request: TrafficRequestSnapshot): TrafficRequestSnapshot {
  const snapshot: TrafficRequestSnapshot = {
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
  };
  if (request.body !== undefined) Object.assign(snapshot, createBodyInfo(request.body));
  else if (request.bodyUnavailable) snapshot.bodyUnavailable = request.bodyUnavailable;
  return snapshot;
}

function describeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

function reportTraffic(message: TrafficWindowMessage) {
  try {
    window.postMessage(message, "*");
  } catch {
    // Failure: 面板上报失败不能影响页面请求。
  }
}

type TrafficCompletion = Omit<TrafficFinishMessage, "channel" | "type" | "id" | "endedAt" | "decision"> & {
  decision?: Exclude<TrafficFinishMessage["decision"], "pending">;
};

// Rule: 两种浏览器 API 共用记录规则；原生事件、请求体读取与取消时序仍由各自路径掌握。
class RequestTraffic {
  private readonly id: string;
  private closed = false;
  private passReason?: ExtensionPassReason;

  constructor(
    source: "fetch" | "xhr",
    request: TrafficRequestSnapshot,
    private decision: "pending" | "capture" | "pass",
    startedAt = currentTime(),
  ) {
    this.id = createTrafficId(source);
    const message: TrafficStartMessage = {
      channel: CHANNEL, type: TRAFFIC_START_TYPE,
      entry: { id: this.id, source, decision, startedAt, request: requestSnapshot(request) },
    };
    reportTraffic(message);
  }

  requestBody(body: TrafficBodyInfo) {
    // Rule: 请求体快照可晚于响应到达，补报不能被结束状态丢弃。
    const message: TrafficRequestBodyMessage = {
      channel: CHANNEL, type: TRAFFIC_REQUEST_BODY_TYPE, id: this.id,
      ...body, ...createBodyInfo(body.body),
    };
    reportTraffic(message);
  }

  pass(reason?: ExtensionPassReason) {
    this.decision = "pass";
    this.passReason = reason;
  }

  finish(read: TrafficCompletion | (() => TrafficCompletion)) {
    if (this.closed) return;
    this.closed = true;
    // Guarantee: 旧 loadend 不再读取重开后的原生 XHR 响应。
    const result = typeof read === "function" ? read() : read;
    const message: TrafficFinishMessage = {
      channel: CHANNEL, type: TRAFFIC_FINISH_TYPE, id: this.id,
      ...result,
      decision: result.decision ?? (this.decision === "pending" ? "pass" : this.decision),
      passReason: result.passReason ?? this.passReason,
      endedAt: currentTime(),
      ...(result.response ? { response: { ...result.response, ...createBodyInfo(result.response.body) } } : {}),
    };
    reportTraffic(message);
  }
}

function askResolver(request: ExtensionRuntimeRequest, signal?: AbortSignal): Promise<ExtensionRuntimeResponse> {
  if (signal?.aborted) return Promise.resolve({ action: "pass", reason: "invalid-request" });

  return new Promise((resolve) => {
    const id = `${requestIdPrefix}-${nextRequestId++}`;
    let settled = false;
    let timer = 0;
    const settle = (result: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      pendingResolutions.delete(id);
      resolve(isRuntimeResponse(result) ? result : { action: "pass", reason: "invalid-request" });
    };
    const cancel = () => {
      if (settled) return;
      try {
        window.postMessage({ channel: CHANNEL, type: "cancel", id } satisfies ResolveCancelMessage, "*");
      } catch {
        // Ignore cancellation delivery failures; the local request still fails open.
      }
      settle({ action: "pass", reason: "invalid-request" });
    };
    const onAbort = cancel;
    timer = window.setTimeout(cancel, CONTENT_RESOLVE_TIMEOUT_MS);

    pendingResolutions.set(id, settle);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
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
  if (interceptedXMLHttpRequest) {
    window.XMLHttpRequest = interceptedXMLHttpRequest;
    return;
  }
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
      mockAbortController: new AbortController(),
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
  interceptedXMLHttpRequest = MockAwareXMLHttpRequest as unknown as typeof XMLHttpRequest;
  window.XMLHttpRequest = interceptedXMLHttpRequest;
}

type XhrMode = "unopened" | "pending" | "direct" | "mock";
type XhrListener = {
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
  nativeListener?: EventListener;
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
  mockAbortController: AbortController;
  withCredentials: boolean;
  responseType: XMLHttpRequestResponseType;
  requestHeaders: Record<string, string>;
  handlers: Map<string, EventListenerOrEventListenerObject | null>;
  listeners: XhrListener[];
  mock?: Extract<ExtensionRuntimeResponse, { action: "mock" }>;
  timeoutTimer?: number;
  traffic?: RequestTraffic;
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
  if ((!isMonitoringActive() && !isCaptureActive()) || !async || !isHttpUrl(url.href)) {
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
  const mockActive = isMonitoringActive();
  if (isBinaryOrStreamBody(body) || (!mockActive && !isCaptureActive())) {
    if (isBinaryOrStreamBody(body) && (mockActive || isCaptureActive())) {
      state.traffic = new RequestTraffic("xhr", {
        url: state.url,
        method: state.method.toUpperCase(),
        headers: { ...state.requestHeaders },
        bodyUnavailable: "binary",
      }, "capture");
    }
    return useDirectXhr(state, body);
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    // Guarantee: 固定 send 时的字段顺序和 File 引用，不读取文件内容，避免等待期间被页面修改。
    const snapshot = new FormData();
    body.forEach((value, name) => snapshot.append(name, value));
    body = snapshot;
  }
  state.sent = true;
  const generation = state.generation;
  if (state.timeout > 0) state.timeoutTimer = window.setTimeout(() => timeoutXhr(state, generation), state.timeout);

  const request: ExtensionRuntimeRequest = {
    url: state.url,
    method: state.method.toUpperCase(),
    headers: { ...state.requestHeaders },
  };
  if ((typeof FormData !== "undefined" && body instanceof FormData) ||
    Object.entries(state.requestHeaders).some(([name, value]) => name.toLowerCase() === "content-type" && value.toLowerCase().startsWith("multipart/")))
    request.bodyUnavailable = "upload";
  else if (typeof body === "string") request.body = body;
  else if (body instanceof URLSearchParams) request.body = body.toString();
  else if (body != null) request.bodyUnavailable = "unavailable";
  state.traffic = new RequestTraffic("xhr", request, mockActive ? "pending" : "capture");
  if (!mockActive) {
    useDirectXhr(state, body);
    return;
  }
  void askResolver(withLogBody(request), state.mockAbortController.signal).then((decision) => {
    if (state.generation !== generation || state.aborted || state.finished) return;
    if (!isMonitoringActive() || decision.action === "pass") {
      state.traffic?.pass(decision.action === "pass" ? decision.reason : undefined);
      return useDirectXhr(state, body);
    }
    if (decision.action === "transform") void useTransformedXhr(state, decision, generation, body);
    else void useMockXhr(state, decision, generation);
  }).catch(() => {
    if (state.generation !== generation || state.aborted || state.finished) return;
    useDirectXhr(state, body);
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
  const traffic = state.traffic;
  if (traffic)
    state.target.addEventListener("loadend", () => finishXhrTraffic(state, traffic), { once: true });
  state.target.send(body);
}

async function useTransformedXhr(
  state: XhrState,
  decision: Extract<ExtensionRuntimeResponse, { action: "transform" }>,
  generation: number,
  body?: Document | XMLHttpRequestBodyInit | null,
) {
  const target = state.target;
  try {
    const real = await new Promise<{ body: string; headers: Record<string, string> }>((resolve, reject) => {
      const cleanup = () => {
        for (const type of ["load", "error", "abort", "timeout"]) target.removeEventListener(type, finish);
        state.mockAbortController.signal.removeEventListener("abort", cancel);
      };
      const cancel = () => { cleanup(); target.abort(); reject(abortError()); };
      const finish = (event: Event) => {
        cleanup();
        if (event.type !== "load") { reject(new Error(`真实 XHR 请求失败：${event.type}`)); return; }
        if (target.status < 200 || target.status >= 300) { reject(new Error(`真实接口返回 HTTP ${target.status}`)); return; }
        const headers = parseResponseHeaders(target.getAllResponseHeaders());
        if (state.method.toUpperCase() === "HEAD" || !/json/i.test(headers["content-type"] ?? "")) { reject(new Error("混合响应需要真实 JSON 响应")); return; }
        resolve({ body: target.responseText, headers });
      };
      target.open(...state.openArgs as [string, string, boolean, string?, string?]);
      target.responseType = "text";
      target.withCredentials = state.withCredentials;
      for (const [name, value] of Object.entries(state.requestHeaders)) target.setRequestHeader(name, value);
      for (const type of ["load", "error", "abort", "timeout"]) target.addEventListener(type, finish);
      state.mockAbortController.signal.addEventListener("abort", cancel, { once: true });
      try { target.send(body); } catch (error) { cleanup(); reject(error); }
    });
    if (state.generation !== generation || state.aborted || state.finished) return;
    const composed = JSON.stringify(composeResponse(decision.responseType, JSON.parse(decision.body), JSON.parse(real.body), decision.fieldPaths));
    await useMockXhr(state, { action: "mock", status: decision.status, delayMs: decision.delayMs, body: composed, headers: composedHeaders(real.headers) }, generation);
  } catch (error) {
    if (state.generation !== generation || state.aborted || state.finished) return;
    clearXhrTimeout(state);
    state.mode = "mock";
    state.readyState = XMLHttpRequest.DONE;
    state.finished = true;
    state.traffic?.finish({ decision: "mock", error: describeError(error) });
    emitXhrEvent(state, "readystatechange");
    emitXhrEvent(state, "error");
    emitXhrEvent(state, "loadend");
  }
}

async function useMockXhr(
  state: XhrState,
  decision: Extract<ExtensionRuntimeResponse, { action: "mock" }>,
  generation: number,
) {
  try {
    await waitForDelay(decision.delayMs, state.mockAbortController.signal);
  } catch (error) {
    if (isAbortError(error)) return;
    throw error;
  }
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
  reportMockXhrTraffic(state, decision);
  emitXhrEvent(state, "readystatechange");
  emitXhrEvent(state, "load");
  emitXhrEvent(state, "loadend");
}

function reportMockXhrTraffic(state: XhrState, decision: Extract<ExtensionRuntimeResponse, { action: "mock" }>) {
  state.traffic?.finish({ decision: "mock", response: {
    status: decision.status,
    statusText: String(decision.status),
    headers: decision.headers,
    mimeType: decision.headers["content-type"],
    body: decision.body,
  } });
}

function finishXhrTraffic(state: XhrState, traffic: RequestTraffic) {
  traffic.finish(() => {
    const target = state.target;
    if (target.status === 0) return { error: state.aborted
      ? { name: "AbortError", message: "请求已取消" }
      : { name: "NetworkError", message: "请求未收到响应" },
    };
    const headers = parseResponseHeaders(target.getAllResponseHeaders());
    return { response: {
      status: target.status,
      statusText: target.statusText,
      headers,
      ...(headers["content-type"] ? { mimeType: headers["content-type"] } : {}),
      ...readXhrBody(target, state.responseType),
    } };
  });
}

function readXhrBody(target: XMLHttpRequest, responseType: XMLHttpRequestResponseType): TrafficBodyInfo {
  if (responseType === "" || responseType === "text") return createBodyInfo(target.responseText);
  if (responseType === "json") {
    try {
      return createBodyInfo(JSON.stringify(target.response));
    } catch {
      return { bodyUnavailable: "unavailable" };
    }
  }
  if (responseType === "blob") {
    const blob = target.response as Blob | null;
    return { bodyUnavailable: "binary", ...(blob ? { size: blob.size } : {}) };
  }
  if (responseType === "arraybuffer") {
    const buffer = target.response as ArrayBuffer | null;
    return { bodyUnavailable: "binary", ...(buffer ? { size: buffer.byteLength } : {}) };
  }
  return { bodyUnavailable: "binary" };
}

function parseResponseHeaders(raw: string) {
  const headers: Record<string, string> = {};
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function abortXhr(state: XhrState) {
  if (state.mode === "direct") {
    state.aborted = true;
    return state.target.abort();
  }
  if (!state.sent || state.finished) return;
  state.mockAbortController.abort();
  state.aborted = true;
  clearXhrTimeout(state);
  state.traffic?.finish({ error: { name: "AbortError", message: "请求已取消" } });
  state.readyState = XMLHttpRequest.DONE;
  state.finished = true;
  emitXhrEvent(state, "abort");
  emitXhrEvent(state, "loadend");
}

function timeoutXhr(state: XhrState, generation: number) {
  if (state.generation !== generation || state.mode !== "pending" || state.finished) return;
  state.mockAbortController.abort();
  state.finished = true;
  state.mode = "mock";
  state.traffic?.finish({ error: { name: "TimeoutError", message: `请求超过 ${state.timeout}ms` } });
  state.readyState = XMLHttpRequest.DONE;
  emitXhrEvent(state, "readystatechange");
  emitXhrEvent(state, "timeout");
  emitXhrEvent(state, "loadend");
}

function resetXhr(state: XhrState) {
  // Guarantee: 放行转混合时，旧原生监听器不能提前泄露未组合响应或与合成事件重复触发。
  for (const property of state.handlers.keys()) Reflect.set(state.target, property, null, state.target);
  for (const item of state.listeners) state.target.removeEventListener(item.type, item.nativeListener ?? item.listener, item.options);
  clearXhrTimeout(state);
  state.traffic?.finish({ error: { name: "AbortError", message: "请求被重新打开" } });
  state.traffic = undefined;
  state.mockAbortController.abort();
  state.mockAbortController = new AbortController();
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
  for (const item of state.listeners) attachNativeXhrListener(state, item);
}

function addXhrListener(state: XhrState, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
  state.listeners = state.listeners.filter((item) => !(typeof item.options === "object" && item.options.signal?.aborted));
  if (typeof options === "object" && options.signal?.aborted) return;
  // Rule: 与原生 addEventListener 一致，相同类型、监听器和捕获阶段的重复注册是幂等的。
  if (state.listeners.some((item) => sameXhrListener(item, type, listener, options))) return;
  const item = { type, listener, options };
  state.listeners.push(item);
  if (state.mode === "direct") attachNativeXhrListener(state, item);
}

function attachNativeXhrListener(state: XhrState, item: XhrListener) {
  item.nativeListener ??= (event) => {
    if (typeof item.options === "object" && item.options.once) state.listeners = state.listeners.filter((entry) => entry !== item);
    invokeListener(item.listener, event, state.proxy);
  };
  state.target.addEventListener(item.type, item.nativeListener, item.options);
}

function removeXhrListener(state: XhrState, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
  // Rule: 无论当前模式都先清理本地记录，避免 direct 往返时把已移除的监听器重新装回原生实例。
  for (const item of state.listeners.filter((entry) => sameXhrListener(entry, type, listener, options))) {
    state.target.removeEventListener(type, item.nativeListener ?? item.listener, item.options);
  }
  state.listeners = state.listeners.filter((item) => !sameXhrListener(item, type, listener, options));
}

function sameXhrListener(item: XhrListener, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions | EventListenerOptions) {
  return item.type === type && item.listener === listener && sameListenerOptions(item.options, options);
}

function emitXhrEvent(state: XhrState, type: string) {
  const event = new Event(type);
  for (const item of [...state.listeners]) {
    if (item.type !== type || (typeof item.options === "object" && item.options.signal?.aborted)) continue;
    if (!state.listeners.includes(item)) continue;
    if (typeof item.options === "object" && item.options.once) removeXhrListener(state, item.type, item.listener, item.options);
    invokeListener(item.listener, event, state.proxy);
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

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof input === "object" && input !== null && "url" in input && typeof input.url === "string") return input.url;
  try {
    return new URL(input instanceof URL ? input.href : String(input), window.location.href).href;
  } catch {
    return null;
  }
}

// Rule: Fastify 的 resolver 请求体默认上限为 1 MiB；日志快照不能让原本可命中的请求变成 413。
const RESOLVER_WIRE_BODY_LIMIT = 1024 * 1024;

function withLogBody(request: ExtensionRuntimeRequest): ExtensionRuntimeRequest {
  if (request.body === undefined || new TextEncoder().encode(JSON.stringify(request)).byteLength <= RESOLVER_WIRE_BODY_LIMIT)
    return request;
  const { body: _body, ...metadata } = request;
  return { ...metadata, bodyUnavailable: "too-large" };
}

async function readRequestBodyForLog(request: Request): Promise<Pick<ExtensionRuntimeRequest, "body" | "bodyUnavailable">> {
  // Rule: multipart 只判定元数据，不读取或复制上传文件。
  if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/")) return { bodyUnavailable: "upload" };
  if (!request.body) return {};
  const reader = request.clone().body!.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let timer = 0;
  const read = (async (): Promise<Pick<ExtensionRuntimeRequest, "body" | "bodyUnavailable">> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > RESOLVER_WIRE_BODY_LIMIT) {
          void reader.cancel().catch(() => {});
          return { bodyUnavailable: "too-large" };
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { body: new TextDecoder().decode(bytes) };
    } catch {
      return { bodyUnavailable: "unavailable" };
    }
  })();
  // Failure: 未结束的流不能延迟现有 resolver 判定；取消快照，不消费原始 Request。
  const timeout = new Promise<Pick<ExtensionRuntimeRequest, "body" | "bodyUnavailable">>((resolve) => {
    timer = window.setTimeout(() => {
      void reader.cancel().catch(() => {});
      resolve({ bodyUnavailable: "unavailable" });
    }, 1000);
  });
  try { return await Promise.race([read, timeout]); }
  finally { window.clearTimeout(timer); }
}

function isBinaryRequest(request: Request) {
  return isBinaryContentType(request.headers.get("content-type") || "");
}

function isBinaryContentType(contentType: string) {
  const value = contentType.toLowerCase();
  return value.startsWith("image/") ||
    value.startsWith("audio/") ||
    value.startsWith("video/") ||
    value === "application/octet-stream";
}

function isBinaryOrStreamBody(value: unknown) {
  if (value == null || typeof value === "string") return false;
  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) return false;
  return (
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof ReadableStream !== "undefined" && value instanceof ReadableStream)
  );
}

function isMonitoringStateWindowMessage(value: unknown): value is MonitoringStateWindowMessage {
  return isRecord(value) && value.channel === CHANNEL && value.type === MONITORING_STATE_TYPE &&
    typeof value.enabled === "boolean" &&
    (value.capture === undefined || typeof value.capture === "boolean");
}

function isRuntimeResponse(value: unknown): value is ExtensionRuntimeResponse {
  if (!isRecord(value) || !["mock", "transform", "pass"].includes(String(value.action))) return false;
  if (value.action === "pass") return true;
  if (value.action === "transform" &&
    (!["real-overrides", "mock-with-real"].includes(String(value.responseType)) || !Array.isArray(value.fieldPaths) ||
      !value.fieldPaths.length || !value.fieldPaths.every((p) => typeof p === "string" && p.startsWith("/") && !/~(?![01])/.test(p)) ||
      [204, 205, 304].includes(Number(value.status)))) return false;
  return (
    typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 200 && value.status <= 599 &&
    typeof value.delayMs === "number" && Number.isInteger(value.delayMs) && value.delayMs >= 0 && value.delayMs <= 30000 &&
    typeof value.body === "string" && (value.action === "transform" || (isRecord(value.headers) && Object.values(value.headers).every((header) => typeof header === "string")))
  );
}

function isResolveResultMessage(value: unknown): value is ResolveResultMessage {
  return isRecord(value) && value.channel === CHANNEL && value.type === "resolve-result" &&
    typeof value.id === "string" && isRuntimeResponse(value.result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headersToRecord(headers: Headers) {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => { result[name] = value; });
  return result;
}

function urlMatchesWhitelist(value: string, whitelist: readonly string[]) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return whitelist.some((domain) => {
      const normalizedDomain = domain.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
      return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
    });
  } catch {
    return false;
  }
}

function isMonitoringActive() {
  return monitoringEnabled && urlMatchesWhitelist(window.location.href, monitoringWhitelist);
}

function isCaptureActive() {
  return captureEnabled;
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
