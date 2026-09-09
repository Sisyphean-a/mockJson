import {
  POPUP_CHANNEL,
  type PopupMessage,
  type PopupResponse,
  type PopupState,
} from "./protocol.js";
import { parseWhitelistText } from "./domain-whitelist.js";

const serverDot = required<HTMLSpanElement>("server-dot");
const serverStatus = required<HTMLElement>("server-status");
const serverDetail = required<HTMLElement>("server-detail");
const globalToggle = required<HTMLInputElement>("global-toggle");
const tabToggle = required<HTMLInputElement>("tab-toggle");
const tabDetail = required<HTMLElement>("tab-detail");
const domainWhitelist = required<HTMLTextAreaElement>("domain-whitelist");
const whitelistStatus = required<HTMLElement>("whitelist-status");
const saveWhitelistButton = required<HTMLButtonElement>("save-whitelist");
const hint = required<HTMLElement>("hint");
const refreshButton = required<HTMLButtonElement>("refresh");

let currentState: PopupState | undefined;

void refresh();

globalToggle.addEventListener("change", () => {
  void update({ channel: POPUP_CHANNEL, type: "set-global", enabled: globalToggle.checked });
});

tabToggle.addEventListener("change", () => {
  if (currentState?.tabId === null || currentState?.tabId === undefined) return;
  void update({
    channel: POPUP_CHANNEL,
    type: "set-tab",
    tabId: currentState.tabId,
    enabled: tabToggle.checked,
  });
});

saveWhitelistButton.addEventListener("click", () => void saveWhitelist());
refreshButton.addEventListener("click", () => void refresh());

async function saveWhitelist() {
  const parsed = parseWhitelistText(domainWhitelist.value);
  if (parsed.invalid.length > 0) {
    whitelistStatus.className = "field-status invalid";
    whitelistStatus.textContent = `无效域名：${parsed.invalid.join("、")}`;
    return;
  }
  await update({ channel: POPUP_CHANNEL, type: "set-whitelist", domains: parsed.domains });
}

async function update(message: PopupMessage) {
  setBusy(true);
  try {
    const response = await send(message);
    if (!response.ok) throw new Error(response.error);
    render(response.state);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "扩展状态暂时不可用");
  } finally {
    setBusy(false);
  }
}

async function refresh() {
  setBusy(true);
  try {
    const response = await send({ channel: POPUP_CHANNEL, type: "get-state" });
    if (!response.ok) throw new Error(response.error);
    render(response.state);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "扩展后台未响应");
  } finally {
    setBusy(false);
  }
}

async function send(message: PopupMessage): Promise<PopupResponse> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!isPopupResponse(response)) throw new Error("扩展后台未返回有效状态");
  return response;
}

function render(state: PopupState) {
  currentState = state;
  serverDot.className = `status-dot ${state.serverOnline ? "online" : "offline"}`;
  serverStatus.textContent = state.serverOnline ? "Mock Console 已连接" : "Mock Console 未连接";
  serverDetail.textContent = state.serverOnline
    ? state.hasPackage ? "当前 Package 已加载" : "服务已连接，但还没有 Package"
    : "请先运行 npm start，或检查本机 22333 端口";

  globalToggle.checked = state.globalEnabled;
  tabToggle.checked = state.tabEnabled;
  tabToggle.disabled = !state.supportedPage || state.tabId === null;
  domainWhitelist.value = state.whitelist.join("\n");
  whitelistStatus.className = "field-status";
  whitelistStatus.textContent = state.whitelist.length === 0
    ? "尚未配置请求域名白名单"
    : `已配置 ${state.whitelist.length} 个请求域名`;
  tabDetail.textContent = !state.supportedPage
    ? "此页面不支持请求拦截"
    : `${state.host || "当前页面"} · ${state.effectiveEnabled ? "已启用" : "已暂停"}`;

  hint.textContent = state.whitelist.length === 0
    ? "请先配置请求域名白名单；留空时所有页面请求都直接使用浏览器原生请求。"
    : state.effectiveEnabled
      ? "白名单请求会询问 Mock Console；规则和场景仍由 Mock Console 管理。"
      : state.globalEnabled
        ? "当前标签页已暂停 Mock，页面请求会直接使用浏览器原生请求。"
        : "全局 Mock 已暂停，所有标签页都会直接使用浏览器原生请求。";
}

function renderError(message: string) {
  serverDot.className = "status-dot offline";
  serverStatus.textContent = "扩展后台不可用";
  serverDetail.textContent = message;
  hint.textContent = "可以点击“刷新状态”重试。";
}

function setBusy(busy: boolean) {
  refreshButton.disabled = busy;
  globalToggle.disabled = busy;
  domainWhitelist.disabled = busy;
  saveWhitelistButton.disabled = busy;
  if (busy) tabToggle.disabled = true;
}

function isPopupResponse(value: unknown): value is PopupResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (!value.ok) return typeof value.error === "string";
  return isPopupState(value.state);
}

function isPopupState(value: unknown): value is PopupState {
  if (!isRecord(value)) return false;
  return (
    typeof value.serverOnline === "boolean" &&
    typeof value.hasPackage === "boolean" &&
    typeof value.supportedPage === "boolean" &&
    (value.tabId === null || typeof value.tabId === "number") &&
    (value.host === null || typeof value.host === "string") &&
    Array.isArray(value.whitelist) &&
    value.whitelist.every((domain) => typeof domain === "string") &&
    typeof value.globalEnabled === "boolean" &&
    typeof value.tabEnabled === "boolean" &&
    typeof value.effectiveEnabled === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function required<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Popup element not found: ${id}`);
  return element as T;
}
