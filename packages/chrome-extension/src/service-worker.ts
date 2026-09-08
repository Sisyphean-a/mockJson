import type {
  ExtensionRuntimeRequest,
  ExtensionRuntimeResponse,
} from "../../mock-console/shared/types.js";
import type { PopupMessage, PopupResponse, PopupState } from "./protocol.js";
import {
  CHANNEL,
  DEFAULT_RUNTIME_URL,
  POPUP_CHANNEL,
  RESOLVE_TIMEOUT_MS,
  RESOLVER_PATH,
  STATUS_PATH,
  isRuntimeResponse,
} from "./protocol.js";

const GLOBAL_ENABLED_KEY = "globalEnabled";
const DISABLED_TAB_IDS_KEY = "disabledTabIds";

type ResolveMessage = {
  channel: typeof CHANNEL;
  type: "resolve";
  id: string;
  request: ExtensionRuntimeRequest;
};

type RuntimeSender = {
  tab?: { id?: number };
};

type ActivationState = {
  globalEnabled: boolean;
  disabledTabIds: number[];
};

type ServerStatus = {
  online: boolean;
  hasPackage: boolean;
};

let activationCache: ActivationState | undefined;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isResolveMessage(message)) {
    const tabId = senderTabId(sender);
    void resolveForTab(message.request, tabId)
      .then(sendResponse)
      .catch(() => sendResponse({ action: "pass", reason: "invalid-request" }));
    return true;
  }

  if (isPopupMessage(message)) {
    void handlePopupMessage(message)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "扩展状态暂时不可用" } satisfies PopupResponse));
    return true;
  }

  return undefined;
});

async function resolveForTab(request: ExtensionRuntimeRequest, tabId: number | undefined) {
  const activation = await getActivationState();
  if (!activation.globalEnabled || (tabId !== undefined && activation.disabledTabIds.includes(tabId)))
    return { action: "pass", reason: "disabled" } as const;
  return resolve(request);
}

async function resolve(request: ExtensionRuntimeRequest): Promise<ExtensionRuntimeResponse> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const response = await fetch(`${DEFAULT_RUNTIME_URL}${RESOLVER_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) return { action: "pass", reason: "invalid-request" };
    const result: unknown = await response.json();
    return isRuntimeResponse(result) ? result : { action: "pass", reason: "invalid-request" };
  } catch {
    return { action: "pass", reason: "invalid-request" };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function handlePopupMessage(message: PopupMessage): Promise<PopupResponse> {
  if (message.type === "set-global") {
    const activation = await getActivationState();
    activation.globalEnabled = message.enabled;
    await saveActivationState(activation);
  } else if (message.type === "set-tab") {
    const activation = await getActivationState();
    activation.disabledTabIds = message.enabled
      ? activation.disabledTabIds.filter((id) => id !== message.tabId)
      : [...new Set([...activation.disabledTabIds, message.tabId])];
    await saveActivationState(activation);
  }
  return popupState();
}

async function popupState(): Promise<PopupResponse> {
  const [tabs, activation, server] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    getActivationState(),
    getServerStatus(),
  ]);
  const tab = tabs[0];
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const url = typeof tab?.url === "string" ? tab.url : "";
  const supportedPage = /^https?:\/\//i.test(url);
  const tabEnabled = tabId === null || !activation.disabledTabIds.includes(tabId);
  const host = supportedPage ? new URL(url).host : null;
  const state: PopupState = {
    serverOnline: server.online,
    hasPackage: server.hasPackage,
    supportedPage,
    tabId,
    host,
    globalEnabled: activation.globalEnabled,
    tabEnabled,
    effectiveEnabled: supportedPage && activation.globalEnabled && tabEnabled,
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
    const stored = await chrome.storage.session.get([GLOBAL_ENABLED_KEY, DISABLED_TAB_IDS_KEY]);
    activationCache = {
      globalEnabled: stored[GLOBAL_ENABLED_KEY] !== false,
      disabledTabIds: Array.isArray(stored[DISABLED_TAB_IDS_KEY])
        ? stored[DISABLED_TAB_IDS_KEY].filter((id): id is number => typeof id === "number" && Number.isInteger(id))
        : [],
    };
  } catch {
    activationCache = { globalEnabled: true, disabledTabIds: [] };
  }
  return activationCache;
}

async function saveActivationState(state: ActivationState) {
  activationCache = state;
  await chrome.storage.session.set({
    [GLOBAL_ENABLED_KEY]: state.globalEnabled,
    [DISABLED_TAB_IDS_KEY]: state.disabledTabIds,
  });
}

function isResolveMessage(value: unknown): value is ResolveMessage {
  if (!isRecord(value) || value.channel !== CHANNEL || value.type !== "resolve" || typeof value.id !== "string") return false;
  return isRuntimeRequest(value.request);
}

function isPopupMessage(value: unknown): value is PopupMessage {
  if (!isRecord(value) || value.channel !== POPUP_CHANNEL || typeof value.type !== "string") return false;
  if (value.type === "get-state") return true;
  if (value.type === "set-global") return typeof value.enabled === "boolean";
  return value.type === "set-tab" && typeof value.tabId === "number" && Number.isInteger(value.tabId) && typeof value.enabled === "boolean";
}

function isRuntimeRequest(value: unknown): value is ExtensionRuntimeRequest {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.method !== "string" || !isRecord(value.headers)) return false;
  return Object.values(value.headers).every((header) => typeof header === "string");
}

function senderTabId(value: unknown) {
  if (!isRecord(value) || !isRecord(value.tab) || typeof value.tab.id !== "number") return undefined;
  return value.tab.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
