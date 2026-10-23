import type {
  ExtensionRuntimeRequest,
  ExtensionRuntimeResponse,
} from "@mock-json/extension-contract";
import type {
  MonitoringQueryMessage,
  MonitoringRefreshMessage,
  PopupMessage,
  ResolveCancelMessage,
  PopupResponse,
  PopupState,
  TrafficPanelMessage,
  TrafficWindowMessage,
} from "./protocol.js";
import {
  CHANNEL,
  DEFAULT_RUNTIME_URL,
  POPUP_CHANNEL,
  RESOLVE_TIMEOUT_MS,
  RESOLVER_PATH,
  STATUS_PATH,
  TRAFFIC_PANEL_PORT,
  isRuntimeResponse,
  isTrafficWindowMessage,
} from "./protocol.js";
import { TabTrafficStore } from "./traffic-store.js";
import { DEFAULT_WHITELIST, WHITELIST_STORAGE_KEY, urlMatchesWhitelist, normalizeWhitelist } from "./domain-whitelist.js";
import {
  createResolverHealth,
  isResolverCircuitOpen,
  RESOLVER_FAILURE_THRESHOLD,
  recordResolverFailure,
  recordResolverSuccess,
} from "./resolver-health.js";

const GLOBAL_ENABLED_KEY = "globalEnabled";
const DISABLED_TAB_IDS_KEY = "disabledTabIds";
const CAPTURE_TAB_IDS_KEY = "captureTabIds";
const RESOLVER_HEALTH_KEY = "resolverHealth";
const TRAFFIC_STORAGE_PREFIX = "traffic:";

type ResolveMessage = {
  channel: typeof CHANNEL;
  type: "resolve";
  id: string;
  request: ExtensionRuntimeRequest;
};

type MonitoringResponse = {
  enabled: boolean;
  capture: boolean;
  whitelist: string[];
};

type ActivationState = {
  globalEnabled: boolean;
  disabledTabIds: number[];
  captureTabIds: number[];
};

type TrafficPort = {
  postMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
};

type ServerStatus = {
  online: boolean;
  hasPackage: boolean;
};

let activationCache: ActivationState | undefined;
let whitelistCache: string[] | undefined;
const resolverHealth = createResolverHealth();
let resolverHealthLoaded = false;
let resolverHealthLoad: Promise<void> | undefined;
let resolverHealthWrite = Promise.resolve();
const pendingResolvers = new Map<string, AbortController>();
const MAX_RESOLVER_CONCURRENCY = 32;
let activeResolverCount = 0;
const trafficPanelPorts = new Map<number, Set<TrafficPort>>();
const trafficStore = new TabTrafficStore({
  async read(tabId) {
    const key = `${TRAFFIC_STORAGE_PREFIX}${tabId}`;
    return (await chrome.storage.session.get([key]))[key];
  },
  async write(tabId, entries) {
    await chrome.storage.session.set({ [`${TRAFFIC_STORAGE_PREFIX}${tabId}`]: entries });
  },
}, broadcastTrafficUpdate);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isResolveMessage(message)) {
    void resolveForTab(message.id, message.request, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ action: "pass", reason: "invalid-request" }));
    return true;
  }

  if (isResolveCancelMessage(message)) {
    pendingResolvers.get(message.id)?.abort();
    return undefined;
  }

  if (isMonitoringQueryMessage(message)) {
    void getMonitoringState(sender)
      .then(sendResponse)
      .catch(() => sendResponse({ enabled: false, capture: false, whitelist: [] } satisfies MonitoringResponse));
    return true;
  }

  if (isTrafficWindowMessage(message)) {
    applyTrafficMessage(message, sender);
    return undefined;
  }

  if (isPopupMessage(message)) {
    void handlePopupMessage(message)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "扩展状态暂时不可用" } satisfies PopupResponse));
    return true;
  }

  return undefined;
});

async function resolveForTab(id: string, request: ExtensionRuntimeRequest, sender: unknown) {
  const controller = new AbortController();
  pendingResolvers.set(id, controller);
  try {
    const [state] = await Promise.all([getMonitoringState(sender), loadResolverHealth()]);
    if (controller.signal.aborted || !state.enabled)
      return { action: "pass", reason: "disabled" } as const;
    return resolve(request, controller);
  } finally {
    pendingResolvers.delete(id);
  }
}

async function getMonitoringState(sender: unknown): Promise<MonitoringResponse> {
  const activation = await getActivationState();
  const tabId = senderTabId(sender);
  const whitelist = await getWhitelist();
  const pageUrl = isRecord(sender) && typeof sender.url === "string" ? sender.url : "";
  // Rule: sender.url 来自 Chrome，按发消息的 frame 自身页面判断，不能信任页面提交的请求 URL 或顶层标签页 URL。
  const enabled = pageUrl !== "" && urlMatchesWhitelist(pageUrl, whitelist) &&
    activation.globalEnabled && (tabId === undefined || !activation.disabledTabIds.includes(tabId));
  const capture = enabled || (tabId !== undefined && activation.captureTabIds.includes(tabId));
  return { enabled, capture, whitelist };
}

function applyTrafficMessage(message: TrafficWindowMessage, sender: unknown) {
  const tabId = senderTabId(sender);
  if (tabId === undefined || !isRecord(sender)) return;
  trafficStore.record(message, {
    tabId,
    frameId: typeof sender.frameId === "number" ? sender.frameId : 0,
    pageUrl: typeof sender.url === "string" ? sender.url : "",
  });
}

function broadcastTrafficUpdate(tabId: number, message: Extract<TrafficPanelMessage, { type: "entry" | "cleared" }>) {
  const ports = trafficPanelPorts.get(tabId);
  if (!ports) return;
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

async function sendTrafficSnapshot(tabId: number, port: TrafficPort) {
  const entries = await trafficStore.snapshot(tabId);
  const activation = await getActivationState();
  const message: TrafficPanelMessage = {
    type: "snapshot",
    entries,
    captureTab: activation.captureTabIds.includes(tabId),
  };
  try {
    port.postMessage(message);
  } catch {
    // Failure: 面板已关闭时忽略推送失败。
  }
}

function broadcastTrafficState(tabId: number, captureTab: boolean) {
  const message: TrafficPanelMessage = { type: "state", captureTab };
  for (const port of trafficPanelPorts.get(tabId) ?? []) {
    try {
      port.postMessage(message);
    } catch {
      // Failure: 面板已关闭时忽略推送失败。
    }
  }
}

async function setCaptureTab(tabId: number, enabled: boolean) {
  const activation = await getActivationState();
  activation.captureTabIds = enabled
    ? [...new Set([...activation.captureTabIds, tabId])]
    : activation.captureTabIds.filter((id) => id !== tabId);
  await saveActivationState(activation);
  await broadcastMonitoringState();
  broadcastTrafficState(tabId, enabled);
}

function registerTrafficPanel() {
  chrome.runtime.onConnect?.addListener?.((port) => {
    if (port.name !== TRAFFIC_PANEL_PORT) return;
    let tabId: number | undefined;
    const addPort = (id: number) => {
      const ports = trafficPanelPorts.get(id) ?? new Set<TrafficPort>();
      ports.add(port);
      trafficPanelPorts.set(id, ports);
    };
    port.onMessage.addListener((message: unknown) => {
      if (!isRecord(message) || typeof message.type !== "string") return;
      if (message.type === "subscribe") {
        if (typeof message.tabId !== "number" || !Number.isInteger(message.tabId)) return;
        tabId = message.tabId;
        addPort(tabId);
        void sendTrafficSnapshot(tabId, port);
        return;
      }
      if (tabId === undefined) return;
      // Rule: 每条命令都确保端口仍在推送集合中，SW 热重启或注册丢失后可自愈。
      addPort(tabId);
      if (message.type === "ping") {
        try {
          port.postMessage({ type: "pong" } satisfies TrafficPanelMessage);
        } catch {
          // Failure: 面板已关闭时忽略。
        }
        return;
      }
      if (message.type === "clear") {
        void trafficStore.clear(tabId);
        return;
      }
      if (message.type === "set-capture" && typeof message.enabled === "boolean") {
        void setCaptureTab(tabId, message.enabled);
      }
    });
    port.onDisconnect.addListener(() => {
      if (tabId === undefined) return;
      const ports = trafficPanelPorts.get(tabId);
      ports?.delete(port);
      if (ports?.size === 0) trafficPanelPorts.delete(tabId);
    });
  });
  chrome.tabs.onRemoved?.addListener?.((tabId) => {
    trafficPanelPorts.delete(tabId);
    void trafficStore.dropTab(tabId);
  });
}

registerTrafficPanel();

async function resolve(request: ExtensionRuntimeRequest, controller: AbortController): Promise<ExtensionRuntimeResponse> {
  // Failure: 连续两次 resolver 失败后短路 3 秒，避免服务不可用时每个页面请求都等待完整超时。
  // Guarantee: 超过并发上限时直接放行，避免扩展排队拖慢页面请求。
  if (isResolverCircuitOpen(resolverHealth) || activeResolverCount >= MAX_RESOLVER_CONCURRENCY)
    return { action: "pass", reason: "invalid-request" };
  if (controller.signal.aborted) return { action: "pass", reason: "invalid-request" };

  activeResolverCount += 1;
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, RESOLVE_TIMEOUT_MS);
  try {
    const response = await fetch(`${DEFAULT_RUNTIME_URL}${RESOLVER_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      recordResolverFailure(resolverHealth);
      persistResolverHealth();
      return { action: "pass", reason: "invalid-request" };
    }
    const result: unknown = await response.json();
    if (!isRuntimeResponse(result)) {
      recordResolverFailure(resolverHealth);
      persistResolverHealth();
      return { action: "pass", reason: "invalid-request" };
    }
    const hadFailureState = resolverHealth.failureStreak > 0 || resolverHealth.unavailableUntil > 0;
    recordResolverSuccess(resolverHealth);
    if (hadFailureState) persistResolverHealth();
    return result;
  } catch {
    if (timedOut || !controller.signal.aborted) {
      recordResolverFailure(resolverHealth);
      persistResolverHealth();
    }
    return { action: "pass", reason: "invalid-request" };
  } finally {
    activeResolverCount -= 1;
    globalThis.clearTimeout(timer);
  }
}

async function loadResolverHealth() {
  if (resolverHealthLoaded) return;
  if (!resolverHealthLoad) {
    resolverHealthLoad = (async () => {
      try {
        const stored = await chrome.storage.session.get([RESOLVER_HEALTH_KEY]);
        const value = stored[RESOLVER_HEALTH_KEY];
        if (
          isRecord(value) &&
          typeof value.failureStreak === "number" &&
          Number.isInteger(value.failureStreak) &&
          value.failureStreak >= 0 &&
          value.failureStreak <= RESOLVER_FAILURE_THRESHOLD &&
          typeof value.unavailableUntil === "number" &&
          Number.isFinite(value.unavailableUntil) &&
          value.unavailableUntil >= 0
        ) {
          resolverHealth.failureStreak = value.failureStreak;
          resolverHealth.unavailableUntil = value.unavailableUntil;
        }
      } catch {
        // Failure: 无法读取短期健康状态时按健康初始值继续，不能阻塞页面请求。
      } finally {
        resolverHealthLoaded = true;
        resolverHealthLoad = undefined;
      }
    })();
  }
  return resolverHealthLoad;
}

function persistResolverHealth() {
  const snapshot = {
    failureStreak: resolverHealth.failureStreak,
    unavailableUntil: resolverHealth.unavailableUntil,
  };
  resolverHealthWrite = resolverHealthWrite.then(async () => {
    try {
      await chrome.storage.session.set({ [RESOLVER_HEALTH_KEY]: snapshot });
    } catch {
      // Failure: 健康状态写入失败不影响当前请求的放行或 Mock。
    }
  });
}

async function handlePopupMessage(message: PopupMessage): Promise<PopupResponse> {
  let refreshMonitoring = false;
  if (message.type === "set-global") {
    const activation = await getActivationState();
    activation.globalEnabled = message.enabled;
    await saveActivationState(activation);
    refreshMonitoring = true;
  } else if (message.type === "set-tab") {
    const activation = await getActivationState();
    activation.disabledTabIds = message.enabled
      ? activation.disabledTabIds.filter((id) => id !== message.tabId)
      : [...new Set([...activation.disabledTabIds, message.tabId])];
    await saveActivationState(activation);
    refreshMonitoring = true;
  } else if (message.type === "set-capture-tab") {
    const activation = await getActivationState();
    activation.captureTabIds = message.enabled
      ? [...new Set([...activation.captureTabIds, message.tabId])]
      : activation.captureTabIds.filter((id) => id !== message.tabId);
    await saveActivationState(activation);
    broadcastTrafficState(message.tabId, message.enabled);
    refreshMonitoring = true;
  } else if (message.type === "set-whitelist") {
    const domains = normalizeWhitelist(message.domains);
    if (domains.length !== message.domains.length) throw new Error("白名单包含无效域名");
    await saveWhitelist(domains);
    refreshMonitoring = true;
  }
  if (refreshMonitoring) void broadcastMonitoringState();
  return popupState();
}

async function popupState(): Promise<PopupResponse> {
  const [tabs, activation, server, whitelist] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    getActivationState(),
    getServerStatus(),
    getWhitelist(),
  ]);
  const tab = tabs[0];
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const url = typeof tab?.url === "string" ? tab.url : "";
  const supportedPage = /^https?:\/\//i.test(url);
  const tabEnabled = tabId === null || !activation.disabledTabIds.includes(tabId);
  const host = supportedPage ? new URL(url).host : null;
  const pageWhitelisted = urlMatchesWhitelist(url, whitelist);
  const state: PopupState = {
    serverOnline: server.online,
    hasPackage: server.hasPackage,
    supportedPage,
    pageWhitelisted,
    tabId,
    host,
    whitelist,
    globalEnabled: activation.globalEnabled,
    tabEnabled,
    effectiveEnabled: pageWhitelisted && activation.globalEnabled && tabEnabled,
    captureTab: tabId !== null && activation.captureTabIds.includes(tabId),
  };
  return { ok: true, state };
}

async function getServerStatus(): Promise<ServerStatus> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`${DEFAULT_RUNTIME_URL}${STATUS_PATH}`, { signal: controller.signal });
    if (!response.ok) return { online: false, hasPackage: false };
    const value: unknown = await response.json();
    if (!isRecord(value)) return { online: false, hasPackage: false };
    return { online: value.online === true, hasPackage: value.hasPackage === true };
  } catch {
    return { online: false, hasPackage: false };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function getActivationState(): Promise<ActivationState> {
  if (activationCache) return activationCache;
  try {
    const stored = await chrome.storage.session.get([GLOBAL_ENABLED_KEY, DISABLED_TAB_IDS_KEY, CAPTURE_TAB_IDS_KEY]);
    activationCache = {
      globalEnabled: stored[GLOBAL_ENABLED_KEY] !== false,
      disabledTabIds: Array.isArray(stored[DISABLED_TAB_IDS_KEY])
        ? stored[DISABLED_TAB_IDS_KEY].filter((id): id is number => typeof id === "number" && Number.isInteger(id))
        : [],
      captureTabIds: Array.isArray(stored[CAPTURE_TAB_IDS_KEY])
        ? stored[CAPTURE_TAB_IDS_KEY].filter((id): id is number => typeof id === "number" && Number.isInteger(id))
        : [],
    };
  } catch {
    activationCache = { globalEnabled: true, disabledTabIds: [], captureTabIds: [] };
  }
  return activationCache;
}

async function saveActivationState(state: ActivationState) {
  activationCache = state;
  await chrome.storage.session.set({
    [GLOBAL_ENABLED_KEY]: state.globalEnabled,
    [DISABLED_TAB_IDS_KEY]: state.disabledTabIds,
    [CAPTURE_TAB_IDS_KEY]: state.captureTabIds,
  });
}

async function getWhitelist() {
  if (whitelistCache) return whitelistCache;
  try {
    const stored = await chrome.storage.local.get([WHITELIST_STORAGE_KEY]);
    whitelistCache = Object.prototype.hasOwnProperty.call(stored, WHITELIST_STORAGE_KEY)
      ? normalizeWhitelist(stored[WHITELIST_STORAGE_KEY])
      : [...DEFAULT_WHITELIST];
  } catch {
    whitelistCache = [];
  }
  return whitelistCache;
}

async function saveWhitelist(domains: string[]) {
  whitelistCache = domains;
  await chrome.storage.local.set({ [WHITELIST_STORAGE_KEY]: domains });
}

async function broadcastMonitoringState() {
  try {
    const tabs = await chrome.tabs.query({});
    const message: MonitoringRefreshMessage = { channel: CHANNEL, type: "refresh-monitoring" };
    await Promise.allSettled(
      tabs
        .map((tab) => tab.id)
        .filter((id): id is number => typeof id === "number")
        .map((tabId) => chrome.tabs.sendMessage(tabId, message)),
    );
  } catch {
    // Tabs without a content script (or closed during the update) can be ignored.
  }
}

function isMonitoringQueryMessage(value: unknown): value is MonitoringQueryMessage {
  return isRecord(value) && value.channel === CHANNEL && value.type === "get-monitoring";
}

function isResolveMessage(value: unknown): value is ResolveMessage {
  if (!isRecord(value) || value.channel !== CHANNEL || value.type !== "resolve" || typeof value.id !== "string") return false;
  return isRuntimeRequest(value.request);
}

function isResolveCancelMessage(value: unknown): value is ResolveCancelMessage {
  return isRecord(value) && value.channel === CHANNEL && value.type === "cancel" && typeof value.id === "string";
}

function isPopupMessage(value: unknown): value is PopupMessage {
  if (!isRecord(value) || value.channel !== POPUP_CHANNEL || typeof value.type !== "string") return false;
  if (value.type === "get-state") return true;
  if (value.type === "set-global") return typeof value.enabled === "boolean";
  if (value.type === "set-tab")
    return typeof value.tabId === "number" && Number.isInteger(value.tabId) && typeof value.enabled === "boolean";
  if (value.type === "set-capture-tab")
    return typeof value.tabId === "number" && Number.isInteger(value.tabId) && typeof value.enabled === "boolean";
  return value.type === "set-whitelist" && Array.isArray(value.domains) && value.domains.every((domain) => typeof domain === "string");
}

function isRuntimeRequest(value: unknown): value is ExtensionRuntimeRequest {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.method !== "string" || !isRecord(value.headers)) return false;
  return Object.values(value.headers).every((header) => typeof header === "string") &&
    (value.body === undefined || typeof value.body === "string") &&
    (value.bodyUnavailable === undefined || value.bodyUnavailable === "too-large" || value.bodyUnavailable === "unavailable" || value.bodyUnavailable === "upload") &&
    !(value.body !== undefined && value.bodyUnavailable !== undefined);
}

function senderTabId(value: unknown) {
  if (!isRecord(value) || !isRecord(value.tab) || typeof value.tab.id !== "number") return undefined;
  return value.tab.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
