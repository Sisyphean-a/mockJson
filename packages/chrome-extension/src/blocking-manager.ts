import { RequestBlockingClient } from "./blocking-client.js";
import { httpUrl, normalizeBlockingInput, type BlockingRule, type BlockingRuleInput } from "./blocking-rules.js";

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = get<HTMLFormElement>("editor");
const fields = get<HTMLFieldSetElement>("editor-fields");
const scopeFilter = get<HTMLSelectElement>("scope-filter");
const search = get<HTMLInputElement>("rule-search");
const scopeMode = get<HTMLSelectElement>("scope-mode");
const scopeUrl = get<HTMLInputElement>("scope-url");
const targetUrl = get<HTMLInputElement>("target-url");
const method = get<HTMLInputElement>("method");
const matchMode = get<HTMLSelectElement>("match-mode");
const enabled = get<HTMLInputElement>("enabled");
const error = get<HTMLElement>("error");
const connection = get<HTMLElement>("connection");
const add = get<HTMLButtonElement>("add");
let rules: BlockingRule[] = [];
let editing: BlockingRule | undefined;
let deleting: string | undefined;
let busy = false;
let loaded = false;
let initialOrigin = "";
const params = new URLSearchParams(location.search);
try { if (params.get("pageOrigin")) initialOrigin = httpUrl(params.get("pageOrigin")!).origin; } catch { showError("页面站点无效，请手动填写"); }

const client = new RequestBlockingClient(next => {
  rules = next;
  loaded = true;
  connection.textContent = `${rules.length} 条规则 · 同一浏览器用户配置内长期保存`;
  updateScopes();
  render();
}, message => {
  loaded = false;
  connection.textContent = message;
  render();
});

function updateScopes() {
  const selected = scopeFilter.value;
  while (scopeFilter.options.length > 2) scopeFilter.remove(2);
  for (const origin of [...new Set([initialOrigin, ...rules.map(rule => rule.scopeOrigin)].filter(value => value && value !== "*"))].sort()) {
    scopeFilter.add(new Option(origin === initialOrigin ? `当前站点 · ${origin}` : origin, origin));
  }
  scopeFilter.value = selected || (initialOrigin && !scopeFilter.dataset.initialized ? initialOrigin : "");
  scopeFilter.dataset.initialized = "true";
}

function render() {
  add.disabled = busy || !loaded;
  fields.disabled = busy || !loaded;
  const root = get<HTMLElement>("rules");
  root.replaceChildren();
  const query = search.value.trim().toLowerCase();
  const visible = rules.filter(rule => (!scopeFilter.value || rule.scopeOrigin === scopeFilter.value ||
    (scopeFilter.value !== "*" && rule.scopeOrigin === "*")) && `${rule.scopeOrigin} ${rule.method} ${rule.targetUrl}`.toLowerCase().includes(query));
  for (const rule of visible) {
    const row = node("div", rule.enabled ? "rule" : "rule disabled");
    const toggleLabel = node("label", "check");
    const toggle = node("input");
    toggle.type = "checkbox"; toggle.checked = rule.enabled; toggle.disabled = busy || !loaded;
    toggle.setAttribute("aria-label", `启用 ${rule.method} ${rule.targetUrl}`);
    toggle.addEventListener("change", () => { void perform(() => client.save({ ...rule, enabled: toggle.checked }, rule)); });
    toggleLabel.append(toggle);
    const info = node("div", "rule-info");
    info.append(node("code", "rule-target", `${rule.method} ${rule.targetUrl}`),
      node("div", "rule-meta", `${rule.scopeOrigin === "*" ? "所有站点" : rule.scopeOrigin} · ${rule.matchMode === "exact" ? "精确路径" : "路径前缀"}`));
    const actions = node("div", "rule-actions");
    if (deleting === rule.id) {
      actions.append(button("确认删除", () => { void perform(async () => { await client.delete(rule); deleting = undefined; }); }, "danger"),
        button("取消", () => { deleting = undefined; render(); }));
    } else actions.append(button("编辑", () => startEdit(rule, rule)), button("删除", () => { deleting = rule.id; render(); }, "danger"));
    row.append(toggleLabel, info, actions);
    root.append(row);
  }
  const empty = get<HTMLElement>("empty");
  empty.hidden = visible.length > 0 || !loaded;
  empty.textContent = rules.length ? "没有符合条件的规则。" : "还没有屏蔽规则，添加后会在其他页面自动生效。";
}

function startEdit(input?: BlockingRuleInput, rule?: BlockingRule) {
  editing = rule;
  error.hidden = true;
  get<HTMLElement>("editor-title").textContent = rule ? "编辑屏蔽规则" : "添加屏蔽规则";
  scopeMode.value = input?.scopeOrigin === "*" ? "all" : "site";
  scopeUrl.value = input?.scopeOrigin === "*" ? "" : input?.scopeOrigin ?? (scopeFilter.value !== "*" ? scopeFilter.value || initialOrigin : "");
  method.value = input?.method ?? "GET";
  targetUrl.value = input?.targetUrl ?? "";
  matchMode.value = input?.matchMode ?? "exact";
  enabled.checked = input?.enabled ?? true;
  form.hidden = false;
  updateScopeField();
  (scopeMode.value === "site" && !scopeUrl.value ? scopeUrl : targetUrl).focus();
}

function updateScopeField() {
  const global = scopeMode.value === "all";
  get<HTMLElement>("scope-field").hidden = global;
  scopeUrl.required = !global;
  scopeUrl.disabled = global;
}

async function perform(action: () => Promise<void>) {
  busy = true; error.hidden = true; render();
  try { await action(); }
  catch (cause) { showError(cause instanceof Error ? cause.message : "屏蔽规则操作失败"); }
  finally { busy = false; render(); }
}

function showError(message: string) { error.textContent = message; error.hidden = false; }
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
  const element = document.createElement(tag); element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(label: string, run: () => void, className = "") {
  const element = node("button", className, label); element.type = "button"; element.disabled = busy || !loaded;
  element.addEventListener("click", run); return element;
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if (busy) return;
  void perform(async () => {
    const input = normalizeBlockingInput({ enabled: enabled.checked, scopeOrigin: scopeMode.value === "all" ? "*" : scopeUrl.value, method: method.value, targetUrl: targetUrl.value, matchMode: matchMode.value });
    await client.save(input, editing);
    form.hidden = true;
    editing = undefined;
    add.focus();
  });
});
get<HTMLButtonElement>("cancel-edit").addEventListener("click", () => { form.hidden = true; editing = undefined; add.focus(); });
add.addEventListener("click", () => startEdit());
scopeMode.addEventListener("change", updateScopeField);
scopeFilter.addEventListener("change", render);
search.addEventListener("input", render);
window.addEventListener("beforeunload", () => client.close());
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !busy) window.parent.postMessage({ type: "request-blocking-close" }, "*");
});
if (params.has("targetUrl")) {
  try { startEdit(normalizeBlockingInput({ enabled: true, scopeOrigin: initialOrigin, method: params.get("method") ?? "GET", targetUrl: params.get("targetUrl"), matchMode: "exact" })); }
  catch (cause) { showError(cause instanceof Error ? cause.message : "请求地址无效"); }
}
render();
window.parent.postMessage({ type: "request-blocking-ready" }, "*");
