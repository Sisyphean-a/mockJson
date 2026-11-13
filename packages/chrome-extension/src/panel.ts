import {
  TRAFFIC_PANEL_PORT,
  DEFAULT_RUNTIME_URL,
  type TrafficBodyInfo,
  type TrafficEntry,
  type TrafficPanelCommand,
  type TrafficPanelMessage,
} from "./protocol.js";

import { captureUnavailableReason, handoffCapture } from "./capture-handoff.js";
import { RequestContextMenu } from "./panel-context-menu.js";
import { DEFAULT_DETAIL_RATIO, clampDetailRatio, detailRatioFromPointer } from "./panel-split.js";
import { blockingDraft, compileBlockingRules, httpUrl, type BlockingRule } from "./blocking-rules.js";
import { RequestBlockingClient } from "./blocking-client.js";
import { openBlockingDialog } from "./blocking-dialog.js";

type DetailTab = "request" | "response";

const tabId = parseTabId();
const entries = new Map<string, TrafficEntry>();
const captureButton = required<HTMLButtonElement>("capture-toggle");
const pauseButton = required<HTMLButtonElement>("pause");
const clearButton = required<HTMLButtonElement>("clear");
const searchInput = required<HTMLInputElement>("search");
const filterSelect = required<HTMLSelectElement>("filter");
const summary = required<HTMLElement>("summary");
const blockingButton = required<HTMLButtonElement>("blocking");
const listScroll = required<HTMLElement>("list-scroll");
const rows = required<HTMLTableSectionElement>("rows");
const empty = required<HTMLElement>("empty");
const detail = required<HTMLElement>("detail");
const workspace = required<HTMLElement>("workspace");
const splitter = required<HTMLElement>("splitter");
const toast = required<HTMLElement>("toast");

let port: RuntimePort | undefined;
let reconnectTimer = 0;
let heartbeatTimer = 0;
let lastAliveAt = 0;
let pendingClear = false;
let pendingCapture: boolean | undefined;
let clearBarrier = 0;
let inspectedOrigin: string | undefined;
let toastTimer = 0;
let selectedKey: string | undefined;
let paused = false;
let captureTab = false;
let search = "";
let decisionFilter = "all";
let detailTab: DetailTab = "response";
let detailScrollTop = 0;
let detailRatio = DEFAULT_DETAIL_RATIO;
let resizingDetail = false;
let resizePointerId: number | undefined;
let handingOff = false;
let blockingRules: BlockingRule[] = [];
let blocked = compileBlockingRules(blockingRules);
let showBlocked = false;
let blockingError = "正在读取屏蔽规则…";
const requestMenu = new RequestContextMenu({
  save: saveToConsole,
  block: (entry) => { void manageBlocking(entry); },
  openConsole: async (url) => { await chrome.tabs.create({ url }); },
  copy: copyText,
  curl: toCurl,
  notice: showToast,
});
const blockingClient = new RequestBlockingClient(rules => {
  blockingRules = rules;
  blocked = compileBlockingRules(rules);
  blockingError = "";
  refreshBlocking();
}, message => {
  blockingError = message;
  renderSummary();
});
blockingButton.addEventListener("click", () => { void manageBlocking(); });
listScroll.addEventListener("wheel", requestMenu.close, { passive: true });
splitter.addEventListener("pointerdown", startDetailResize);
splitter.addEventListener("pointermove", moveDetailResize);
splitter.addEventListener("pointerup", endDetailResize);
splitter.addEventListener("pointercancel", endDetailResize);
splitter.addEventListener("keydown", resizeDetailWithKeyboard);
window.addEventListener("resize", () => applyDetailRatio());
window.addEventListener("blur", () => endDetailResize());

captureButton.addEventListener("click", () => {
  captureTab = !captureTab;
  renderCapture();
  if (!send({ type: "set-capture", enabled: captureTab })) pendingCapture = captureTab;
  showToast(captureTab ? "正在开启本页记录…" : "正在关闭本页记录…");
});
pauseButton.addEventListener("click", () => {
  paused = !paused;
  pauseButton.textContent = paused ? "继续" : "暂停";
  pauseButton.classList.toggle("active", paused);
  if (!paused) renderList(false);
});
clearButton.addEventListener("click", () => {
  requestMenu.close();
  // Flow: 先清本地列表，再通知后台；端口断开时保留 pendingClear，重连后补发。
  clearBarrier = Date.now();
  pendingClear = true;
  entries.clear();
  selectedKey = undefined;
  detailScrollTop = 0;
  renderAll();
  send({ type: "clear" });
  showToast("已清空当前标签页的请求");
});
searchInput.addEventListener("input", () => {
  requestMenu.close();
  search = searchInput.value.trim().toLowerCase();
  renderList(false);
  listScroll.scrollTop = 0;
});
filterSelect.addEventListener("change", () => {
  requestMenu.close();
  decisionFilter = filterSelect.value;
  renderList(false);
  listScroll.scrollTop = 0;
});
window.addEventListener("beforeunload", () => {
  requestMenu.destroy();
  blockingClient.close();
  window.clearTimeout(reconnectTimer);
  window.clearInterval?.(heartbeatTimer);
  port?.disconnect();
});

if (tabId === null) {
  renderFatal("缺少 tabId。请从 DevTools 打开「接口面板」，或从扩展 Popup 重新进入。");
} else {
  renderAll();
  connect();
  startHeartbeat();
  void chrome.tabs.get(tabId).then(tab => {
    if (tab.url) inspectedOrigin = httpUrl(tab.url).origin;
    renderSummary();
  }).catch(() => { /* Rule: 未授权读取标签页地址时，仍可按记录站点或在弹窗手动配置。 */ });
}

function connect() {
  if (tabId === null) return;
  window.clearTimeout(reconnectTimer);
  if (port) {
    try {
      port.disconnect();
    } catch {
      // Failure: 旧端口已断开时忽略。
    }
    port = undefined;
  }

  let next: RuntimePort;
  try {
    next = chrome.runtime.connect({ name: TRAFFIC_PANEL_PORT });
  } catch {
    scheduleReconnect();
    return;
  }
  port = next;
  lastAliveAt = Date.now();
  next.onMessage.addListener((message: unknown) => {
    if (isPanelMessage(message)) handleMessage(message);
  });
  next.onDisconnect.addListener(() => {
    if (port !== next) return;
    port = undefined;
    scheduleReconnect();
  });
  if (!send({ type: "subscribe", tabId })) {
    scheduleReconnect();
    return;
  }
  if (pendingClear) send({ type: "clear" });
  if (pendingCapture !== undefined && send({ type: "set-capture", enabled: pendingCapture })) pendingCapture = undefined;
}

function scheduleReconnect() {
  if (tabId === null) return;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(connect, 800);
}

function ensureConnection() {
  if (tabId === null) return;
  if (!port) {
    scheduleReconnect();
    return;
  }
  if (!send({ type: "ping" })) scheduleReconnect();
}

function resubscribe() {
  if (tabId === null) return;
  if (!port || !send({ type: "subscribe", tabId })) scheduleReconnect();
}

function startHeartbeat() {
  if (tabId === null) return;
  heartbeatTimer = window.setInterval?.(heartbeat, 10000) ?? 0;
  window.addEventListener("focus", ensureConnection);
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") ensureConnection();
  });
  chrome.devtools?.network?.onNavigated?.addListener?.((url) => {
    resubscribe();
    let origin: string | undefined;
    try {
      origin = new URL(url).origin;
    } catch {
      // Failure: 无效 URL 不参与域名变化提示。
    }
    // Rule: 只有跨域跳转才提示，同源路由变化不打扰。
    if (inspectedOrigin !== undefined && origin !== inspectedOrigin && !captureTab)
      showToast("页面域名已变化；若新页面没有记录，点「记录本页」继续。");
    inspectedOrigin = origin;
  });
}

function heartbeat() {
  if (tabId === null) return;
  if (!port) {
    scheduleReconnect();
    return;
  }
  // Rule: 长时间没有收到任何消息（含 pong）视为端口已失效，主动重建。
  if (Date.now() - lastAliveAt > 25000) {
    try {
      port.disconnect();
    } catch {
      // Failure: 端口已断开时忽略。
    }
    port = undefined;
    scheduleReconnect();
    return;
  }
  ensureConnection();
}

function send(command: TrafficPanelCommand) {
  const current = port;
  if (!current) return false;
  try {
    current.postMessage(command);
    return true;
  } catch {
    if (port === current) {
      port = undefined;
      scheduleReconnect();
    }
    return false;
  }
}

function handleMessage(message: TrafficPanelMessage) {
  lastAliveAt = Date.now();
  if (message.type === "pong") return;
  if (message.type === "snapshot") {
    entries.clear();
    for (const entry of message.entries) {
      if (entry.startedAt < clearBarrier) continue;
      entries.set(keyOf(entry), entry);
    }
    captureTab = message.captureTab;
    pendingCapture = undefined;
    renderAll();
    return;
  }
  if (message.type === "entry") {
    const entry = message.entry as TrafficEntry;
    if (entry.startedAt < clearBarrier) return;
    entries.set(keyOf(entry), entry);
    if (!paused) renderList(true);
    else renderSummary();
    if (selectedKey === keyOf(entry)) renderDetail();
    return;
  }
  if (message.type === "state") {
    captureTab = message.captureTab;
    renderCapture();
    renderEmpty();
    return;
  }
  if (message.type === "cleared") {
    pendingClear = false;
    entries.clear();
    selectedKey = undefined;
    renderAll();
  }
}

function renderAll() {
  renderCapture();
  renderList(false);
  renderDetail();
}

function renderCapture() {
  captureButton.classList.toggle("active", captureTab);
  captureButton.textContent = captureTab ? "记录中" : "记录本页";
  captureButton.title = captureTab ? "点击停止记录本页请求" : "只观测 fetch / XHR，不改写请求";
}

function renderSummary() {
  const hiddenCount = [...entries.values()].filter(entry => blocked(entry)).length;
  summary.textContent = `${visibleEntries().length} / ${entries.size}${hiddenCount ? ` · ${showBlocked ? "命中" : "已屏蔽"} ${hiddenCount} 条` : ""}`;
  summary.title = blockingError || "可见 / 总记录数，屏蔽不删除缓存记录";
  const origins = new Set([...entries.values()].map(entry => { try { return httpUrl(entry.pageUrl).origin; } catch { return ""; } }));
  if (inspectedOrigin) origins.add(inspectedOrigin);
  const count = blockingRules.filter(rule => rule.enabled && (rule.scopeOrigin === "*" || origins.has(rule.scopeOrigin))).length;
  blockingButton.textContent = blockingError ? "屏蔽 !" : count ? `屏蔽 ${count}` : "屏蔽";
  blockingButton.title = blockingError || "管理请求屏蔽规则，仅隐藏记录，不阻止请求";
}

function refreshBlocking() {
  const selected = selectedKey ? entries.get(selectedKey) : undefined;
  if (selected && !showBlocked && blocked(selected)) selectedKey = undefined;
  requestMenu.close();
  renderAll();
}

async function manageBlocking(entry?: TrafficEntry) {
  try {
    let pageOrigin = inspectedOrigin;
    if (!entry && tabId !== null) {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url) pageOrigin = httpUrl(tab.url).origin;
    }
    openBlockingDialog({ pageOrigin, draft: entry ? blockingDraft(entry) : undefined, showBlocked,
      reveal(value) { showBlocked = value; refreshBlocking(); } });
  } catch (error) { showToast(error instanceof Error ? error.message : "无法打开请求屏蔽"); }
}

function renderList(keepScroll: boolean) {
  const visible = visibleEntries();
  const shouldStick = !keepScroll || isNearBottom();
  rows.replaceChildren();
  const focusKey = visible.some((entry) => keyOf(entry) === selectedKey) ? selectedKey : visible[0] && keyOf(visible[0]);
  for (const entry of visible) rows.append(renderRow(entry, keyOf(entry) === focusKey));
  renderSummary();
  renderEmpty(visible.length);
  if (shouldStick) listScroll.scrollTop = listScroll.scrollHeight;
}

function renderEmpty(visibleCount?: number) {
  const count = visibleCount ?? visibleEntries().length;
  empty.hidden = count > 0;
  if (count > 0) return;
  empty.textContent = entries.size === 0
    ? captureTab
      ? "已开始记录，在页面中发起 fetch / XHR 请求后会实时出现。"
      : "还没有记录。点击「记录本页」开始观测；白名单页面开启 Mock 时会自动记录。"
    : "没有符合筛选条件的请求。";
}

function selectEntry(entry: TrafficEntry) {
  selectedKey = keyOf(entry);
  detailScrollTop = 0;
  renderList(true);
  renderDetail();
}

function renderRow(entry: TrafficEntry, focusable: boolean) {
  const row = document.createElement("tr");
  row.tabIndex = focusable ? 0 : -1;
  row.setAttribute("aria-haspopup", "menu");
  if (keyOf(entry) === selectedKey) row.className = "selected";
  const focusSelected = () => rows.querySelector<HTMLTableRowElement>("tr.selected")?.focus({ preventScroll: true });
  const openMenu = (x: number, y: number) => {
    selectEntry(entry);
    requestMenu.open(entry, x, y, focusSelected);
  };
  row.addEventListener("click", () => { requestMenu.close(); selectEntry(entry); focusSelected(); });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openMenu(event.clientX, event.clientY);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      openMenu(rect.left + 20, rect.bottom);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const visible = visibleEntries();
      const index = visible.findIndex((item) => keyOf(item) === keyOf(entry));
      const next = visible[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) { event.preventDefault(); selectEntry(next); focusSelected(); }
    }
  });

  row.append(
    timeCell(entry.startedAt),
    cell(entry.request.method, "method"),
    urlCell(entry.request.url),
    statusCell(entry),
    decisionCell(entry),
    cell(responseCode(entry), "code"),
    cell(formatDuration(entry), "duration"),
  );
  return row;
}

function renderDetail() {
  const entry = selectedKey === undefined ? undefined : entries.get(selectedKey);
  if (!entry) {
    endDetailResize();
    detail.hidden = true;
    splitter.hidden = true;
    detail.replaceChildren();
    detailScrollTop = 0;
    return;
  }
  detail.hidden = false;
  splitter.hidden = false;
  applyDetailRatio();
  detail.replaceChildren(detailHead(entry), detailBody(entry));
}

function applyDetailRatio(ratio = detailRatio) {
  if (detail.hidden) return;
  const height = workspace.getBoundingClientRect().height;
  detailRatio = clampDetailRatio(ratio, height, splitter.getBoundingClientRect().height);
  detail.style.flexBasis = `${(detailRatio * 100).toFixed(2)}%`;
  splitter.setAttribute("aria-valuenow", String(Math.round(detailRatio * 100)));
}

function startDetailResize(event: PointerEvent) {
  if (detail.hidden || event.button !== 0) return;
  resizingDetail = true;
  resizePointerId = event.pointerId;
  event.preventDefault();
  document.body.classList.add("is-resizing");
  splitter.setPointerCapture?.(event.pointerId);
}

function moveDetailResize(event: PointerEvent) {
  if (!resizingDetail) return;
  const rect = workspace.getBoundingClientRect();
  applyDetailRatio(detailRatioFromPointer(event.clientY, rect.top, rect.height, splitter.getBoundingClientRect().height));
}

function endDetailResize(event?: PointerEvent) {
  if (!resizingDetail) return;
  resizingDetail = false;
  document.body.classList.remove("is-resizing");
  const pointerId = event?.pointerId ?? resizePointerId;
  if (pointerId !== undefined) {
    try { splitter.releasePointerCapture(pointerId); } catch { /* Failure: 指针已释放时忽略。 */ }
  }
  resizePointerId = undefined;
}

function resizeDetailWithKeyboard(event: KeyboardEvent) {
  if (detail.hidden) return;
  const step = event.shiftKey ? 0.05 : 0.02;
  if (event.key === "ArrowUp") applyDetailRatio(detailRatio + step);
  else if (event.key === "ArrowDown") applyDetailRatio(detailRatio - step);
  else if (event.key === "Home") applyDetailRatio(0);
  else if (event.key === "End") applyDetailRatio(1);
  else return;
  event.preventDefault();
}

function detailHead(entry: TrafficEntry) {
  const head = el("div", "detail-head");
  const line = el("div", "detail-line");
  const url = el("span", "detail-url", pathOf(entry.request.url));
  url.title = entry.request.url;
  const close = el("button", "detail-close", "×");
  close.type = "button";
  close.title = "关闭详情";
  close.addEventListener("click", () => {
    selectedKey = undefined;
    detailScrollTop = 0;
    renderList(true);
    renderDetail();
  });

  line.append(
    statusBadge(entry),
    el("span", "detail-method", entry.request.method),
    url,
    el("span", "detail-meta", detailMeta(entry)),
    close,
  );
  head.append(line, detailBar(entry));
  return head;
}

function detailBar(entry: TrafficEntry) {
  const bar = el("div", "detail-bar");
  bar.append(tabButton("请求", "request"), tabButton("响应", "response"));
  const actions = el("div", "detail-actions");
  if (entry.decision !== "mock") {
    const saveMock = actionButton(handingOff ? "发送中…" : "保存为 Mock 场景", () => { void saveToConsole(entry); });
    const reason = captureUnavailableReason(entry);
    saveMock.disabled = handingOff || Boolean(reason);
    saveMock.title = reason || "将此响应带到 22333 控制台，确认后保存；不会自动启用";
    saveMock.classList.add("mock-action");
    actions.append(saveMock);
  }
  actions.append(actionButton("打开控制台", () => {
    void chrome.tabs.create({ url: DEFAULT_RUNTIME_URL }).catch(() => showToast("无法打开控制台，请访问 127.0.0.1:22333"));
  }));
  actions.append(actionButton("复制 URL", () => copyText(entry.request.url)));
  if (detailTab === "request") actions.append(actionButton("复制 cURL", () => copyText(toCurl(entry))));
  if (detailTab === "response" && entry.response?.body !== undefined)
    actions.append(actionButton("复制响应", () => copyText(entry.response?.body ?? "")));
  bar.append(actions);
  return bar;
}

async function saveToConsole(entry: TrafficEntry) {
  if (handingOff) return;
  handingOff = true;
  renderDetail();
  try {
    const ticket = await handoffCapture(entry);
    await chrome.tabs.create({ url: `${DEFAULT_RUNTIME_URL}/#capture=${encodeURIComponent(ticket.id)}` });
    showToast("已带到控制台，请确认并保存；草稿 15 分钟内有效");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "无法交接响应");
  } finally {
    handingOff = false;
    renderDetail();
  }
}

function tabButton(label: string, tab: DetailTab) {
  const button = el("button", `tab${detailTab === tab ? " active" : ""}`, label);
  button.type = "button";
  button.addEventListener("click", () => {
    detailTab = tab;
    detailScrollTop = 0;
    renderDetail();
  });
  return button;
}

function detailBody(entry: TrafficEntry) {
  const body = el("div", "detail-body");
  if (detailTab === "response" && entry.error) {
    body.append(el("p", "error-text", `${entry.error.name}: ${entry.error.message}`));
  }
  const grid = el("div", "detail-grid");
  if (detailTab === "request") {
    grid.append(
      detailColumn("请求头", headerContent(entry.request.headers), "scroll"),
      detailColumn("请求体", bodyContent(entry.request, "无请求体"), "body"),
    );
  } else if (entry.response) {
    grid.append(
      detailColumn("响应头", headerContent(entry.response.headers), "scroll"),
      detailColumn("响应体", bodyContent(entry.response, "无响应体"), "body"),
    );
  } else {
    const emptyText = entry.error ? "无响应" : "等待响应";
    grid.append(
      detailColumn("响应头", el("p", "muted", emptyText), "scroll"),
      detailColumn("响应体", el("p", "muted", emptyText), "scroll"),
    );
  }
  body.append(grid);
  body.scrollTop = detailScrollTop;
  body.addEventListener("scroll", () => {
    detailScrollTop = body.scrollTop;
  });
  return body;
}

function detailColumn(title: string, content: HTMLElement, mode: "scroll" | "body") {
  const column = el("div", "detail-col");
  column.append(el("h2", "", title));
  if (mode === "scroll") {
    const scroll = el("div", "detail-scroll");
    scroll.append(content);
    column.append(scroll);
  } else {
    column.append(content);
  }
  return column;
}

function headerContent(headers: Record<string, string>) {
  return Object.keys(headers).length > 0 ? headerTable(headers) : el("p", "muted", "无");
}

function bodyContent(holder: TrafficBodyInfo, emptyText: string) {
  if (holder.bodyUnavailable) return el("p", "muted", unavailableText(holder.bodyUnavailable));
  if (holder.body === undefined) return el("p", "muted", emptyText);
  const panel = el("div", "body-panel");
  if (holder.bodyTruncated) panel.append(el("p", "muted", "已截断，仅显示前 64 KB。"));
  const body = el("pre", "body");
  appendBody(body, holder.body);
  panel.append(body);
  return panel;
}

function visibleEntries() {
  return [...entries.values()]
    .filter((entry) => matchesFilter(entry))
    .sort((left, right) => left.startedAt - right.startedAt);
}

function matchesFilter(entry: TrafficEntry) {
  if (!showBlocked && blocked(entry)) return false;
  if (decisionFilter === "mock" && entry.decision !== "mock") return false;
  if (decisionFilter === "pass" && entry.decision !== "pass") return false;
  if (decisionFilter === "capture" && entry.decision !== "capture") return false;
  if (decisionFilter === "fail" && !entry.error && !(entry.response && entry.response.status >= 400)) return false;
  if (search === "") return true;
  const haystack = `${entry.request.method} ${entry.request.url} ${entry.response?.status ?? ""}`.toLowerCase();
  return haystack.includes(search);
}

function renderFatal(message: string) {
  rows.replaceChildren();
  summary.textContent = "0";
  empty.textContent = message;
  empty.hidden = false;
  detail.hidden = true;
  detail.replaceChildren();
  detailScrollTop = 0;
  captureButton.disabled = true;
  pauseButton.disabled = true;
  clearButton.disabled = true;
  searchInput.disabled = true;
  filterSelect.disabled = true;
}

function isNearBottom() {
  return listScroll.scrollTop + listScroll.clientHeight >= listScroll.scrollHeight - 48;
}

function keyOf(entry: TrafficEntry) {
  return `${entry.frameId}:${entry.id}`;
}

function cell(text: string, className: string) {
  return el("td", className, text);
}

function timeCell(startedAt: number) {
  const cell = el("td", "time", formatTime(startedAt));
  cell.title = new Date(startedAt).toLocaleString();
  return cell;
}

function urlCell(value: string) {
  const td = el("td");
  const span = el("span", "url");
  try {
    const url = new URL(value);
    const host = el("span", "host", url.host);
    const path = el("span", "path", `${url.pathname}${url.search}`);
    span.append(host, path);
  } catch {
    span.textContent = value;
  }
  span.title = value;
  td.append(span);
  return td;
}

function statusCell(entry: TrafficEntry) {
  const td = el("td");
  td.append(statusBadge(entry));
  return td;
}

function statusBadge(entry: TrafficEntry) {
  const info = statusInfo(entry);
  return el("span", `badge ${info.className}`, info.text);
}

function decisionCell(entry: TrafficEntry) {
  const td = el("td");
  td.append(el("span", `badge ${decisionClass(entry.decision)}`, decisionShortLabel(entry.decision)));
  return td;
}

function responseCode(entry: TrafficEntry): string {
  const response = entry.response;
  if (entry.error || !response || response.status < 200 || response.status >= 300 ||
      response.body === undefined || response.bodyTruncated || response.bodyUnavailable) return "-";
  try {
    const body: unknown = JSON.parse(response.body);
    if (!isRecord(body) || !Object.hasOwn(body, "code")) return "-";
    return typeof body.code === "string" ? body.code : JSON.stringify(body.code);
  } catch {
    // Rule: 非 JSON 响应不展示业务 code。
    return "-";
  }
}

function formatDuration(entry: TrafficEntry) {
  return entry.endedAt === undefined ? "进行中" : `${Math.max(0, Math.round(entry.endedAt - entry.startedAt))} ms`;
}

function statusInfo(entry: TrafficEntry) {
  if (entry.response) {
    const code = entry.response.status;
    return { text: String(code), className: code >= 400 ? "bad" : code >= 300 ? "info" : "ok" };
  }
  if (entry.error) {
    return { text: entry.error.name === "AbortError" ? "取消" : "失败", className: "bad" };
  }
  return { text: "…", className: "muted" };
}

function decisionShortLabel(decision: TrafficEntry["decision"]) {
  if (decision === "mock") return "Mock";
  if (decision === "pass") return "放行";
  if (decision === "capture") return "只记录";
  return "判定中";
}

function decisionClass(decision: TrafficEntry["decision"]) {
  if (decision === "mock") return "mock";
  if (decision === "pass") return "info";
  if (decision === "capture") return "warn";
  return "muted";
}

function detailMeta(entry: TrafficEntry) {
  const decision = entry.decision === "mock"
    ? "Mock"
    : entry.decision === "pass"
      ? `放行${entry.passReason ? ` · ${passReasonLabel(entry.passReason)}` : ""}`
      : entry.decision === "capture"
        ? "只记录"
        : "判定中";
  return `${formatDuration(entry)} · ${decision}`;
}

function passReasonLabel(reason: string) {
  if (reason === "unmatched") return "未命中";
  if (reason === "disabled") return "已暂停或未授权";
  if (reason === "invalid-request") return "判定无效";
  if (reason === "unsupported-status") return "状态码不支持";
  if (reason === "api-passthrough") return "接口已设为放行";
  return reason;
}

function formatTime(ms: number) {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function pathOf(value: string) {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function headerTable(headers: Record<string, string>) {
  const table = el("table", "headers");
  for (const [name, value] of Object.entries(headers)) {
    const row = document.createElement("tr");
    row.append(el("td", "", name), el("td", "", value));
    table.append(row);
  }
  return table;
}

function unavailableText(reason: NonNullable<TrafficBodyInfo["bodyUnavailable"]>) {
  if (reason === "upload") return "上传请求体未采集：multipart / FormData 只记录元数据。";
  if (reason === "too-large") return "内容超过采集上限，未记录。";
  if (reason === "binary") return "二进制或流式内容不记录。";
  return "内容不可读取（跨域限制或流已被使用）。";
}

// Flow: JSON 先整段格式化，再按 22333 控制台编辑器的配色标记；其他内容保持原文。
function appendBody(target: HTMLElement, body: string) {
  const pretty = prettyBody(body);
  if (!pretty.isJson) {
    target.textContent = body;
    return;
  }
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of pretty.text.matchAll(JSON_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) fragment.append(pretty.text.slice(last, start));
    const token = match[0];
    const end = start + token.length;
    if (token.startsWith("\"")) {
      // Rule: 属性名沿用正文色，与控制台一致，只有字符串值参与高亮。
      fragment.append(pretty.text[end] === ":" ? pretty.text.slice(start, end) : el("span", "json-string", token));
    } else if (token === "true" || token === "false") {
      fragment.append(el("span", "json-bool", token));
    } else if (token === "null") {
      fragment.append(el("span", "json-null", token));
    } else {
      fragment.append(el("span", "json-number", token));
    }
    last = end;
  }
  if (last < pretty.text.length) fragment.append(pretty.text.slice(last));
  target.append(fragment);
}

function prettyBody(body: string) {
  const trimmed = body.trim();
  if (trimmed === "" || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return { text: body, isJson: false };
  try {
    return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true };
  } catch {
    return { text: body, isJson: false };
  }
}

const JSON_TOKEN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;

function toCurl(entry: TrafficEntry) {
  const parts = [`curl '${shellQuote(entry.request.url)}'`];
  if (entry.request.method !== "GET") parts.push(`-X ${entry.request.method}`);
  for (const [name, value] of Object.entries(entry.request.headers)) {
    if (/^(content-length|host)$/i.test(name)) continue;
    parts.push(`-H '${shellQuote(`${name}: ${value}`)}'`);
  }
  if (entry.request.body !== undefined) parts.push(`--data-raw '${shellQuote(entry.request.body)}'`);
  return parts.join(" \\\n  ");
}

function shellQuote(value: string) {
  return value.replace(/'/g, `'\\''`);
}

function actionButton(text: string, onClick: () => void) {
  const button = el("button", "", text);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text).then(
    () => showToast("已复制到剪贴板"),
    () => showToast("复制失败，请手动选择文本"),
  );
}

function showToast(message: string) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function required<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Panel element not found: ${id}`);
  return element as T;
}

function parseTabId() {
  // Flow: DevTools 面板直接读当前被检查标签页；独立页面从 URL 读取。
  const devtoolsTabId = chrome.devtools?.inspectedWindow?.tabId;
  if (typeof devtoolsTabId === "number" && Number.isInteger(devtoolsTabId) && devtoolsTabId >= 0) return devtoolsTabId;
  const value = new URLSearchParams(window.location.search).get("tabId");
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

function isPanelMessage(value: unknown): value is TrafficPanelMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "snapshot") {
    return Array.isArray(value.entries) && typeof value.captureTab === "boolean";
  }
  if (value.type === "entry") return isRecord(value.entry);
  if (value.type === "state") return typeof value.captureTab === "boolean";
  if (value.type === "pong") return true;
  return value.type === "cleared";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
