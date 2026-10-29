import type { ExtensionControlInspection, ExtensionControlledApi, ExtensionControlCommand } from "@mock-json/extension-contract";
import type { TrafficEntry } from "./protocol.js";
import { captureUnavailableReason } from "./capture-handoff.js";
import { inspectRequestControls, applyRequestControl, consoleApiUrl } from "./request-controls.js";

type Actions = {
  save(entry: TrafficEntry): Promise<void>;
  openConsole(url: string): Promise<void>;
  copy(text: string): void;
  curl(entry: TrafficEntry): string;
  notice(message: string): void;
};

export class RequestContextMenu {
  private readonly root = document.createElement("div");
  private entry?: TrafficEntry;
  private info?: ExtensionControlInspection;
  private api?: ExtensionControlledApi;
  private view: "apis" | "actions" | "scenarios" = "actions";
  private loading = false;
  private busy = false;
  private error = "";
  private generation = 0;
  private controller?: AbortController;
  private restoreFocus = () => {};
  private x = 0;
  private y = 0;
  private destroyed = false;

  constructor(private readonly actions: Actions) {
    this.root.className = "request-context-menu";
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.setAttribute("role", "menu");
    this.root.setAttribute("aria-label", "接口快捷操作");
    this.root.addEventListener("keydown", (event) => this.keydown(event));
    this.root.addEventListener("contextmenu", (event) => event.preventDefault());
    document.body.append(this.root);
    document.addEventListener("pointerdown", this.outside);
    window.addEventListener("resize", this.close);
  }

  open(entry: TrafficEntry, x: number, y: number, restoreFocus: () => void) {
    if (this.busy || this.destroyed) return;
    this.close();
    this.entry = entry;
    this.x = x;
    this.y = y;
    this.restoreFocus = restoreFocus;
    this.root.hidden = false;
    void this.load();
  }

  close = () => {
    if (this.busy) return;
    const wasOpen = !this.root.hidden;
    this.generation++;
    this.controller?.abort();
    this.root.hidden = true;
    this.root.replaceChildren();
    this.entry = undefined;
    this.api = undefined;
    this.info = undefined;
    if (wasOpen) this.restoreFocus();
  };

  destroy() {
    this.destroyed = true;
    this.busy = false;
    this.close();
    document.removeEventListener("pointerdown", this.outside);
    window.removeEventListener("resize", this.close);
    this.root.remove();
  }

  private outside = (event: PointerEvent) => {
    if (!this.root.contains(event.target as Node | null)) this.close();
  };

  private async load() {
    const entry = this.entry;
    if (!entry) return;
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.loading = true;
    this.error = "";
    this.info = undefined;
    this.api = undefined;
    this.render();
    try {
      const info = await inspectRequestControls(entry, controller.signal);
      if (generation !== this.generation || this.destroyed) return;
      this.info = info;
      this.api = info.apis.length === 1 ? info.apis[0] : undefined;
      this.view = this.api ? "actions" : "apis";
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      this.error = message(error);
    } finally {
      if (generation === this.generation && !this.destroyed) {
        this.loading = false;
        this.render();
      }
    }
  }

  private render() {
    this.root.replaceChildren();
    this.root.setAttribute("aria-busy", String(this.loading || this.busy));
    const entry = this.entry;
    if (!entry) return;
    let path = entry.request.url;
    try { path = new URL(path).pathname; } catch { /* Rule: 原样显示无效 URL，读取配置时再明确报错。 */ }
    const title = node("div", "context-title", `${entry.request.method} ${path}`);
    title.title = entry.request.url;
    this.root.append(title);
    if (this.busy) this.root.append(node("div", "context-status", `正在保存「${this.api?.name ?? "接口"}」…`));
    else if (this.loading) this.root.append(node("div", "context-status", "正在读取 Mock 配置…"));
    else if (this.error) {
      const error = node("div", "context-error", this.error);
      error.setAttribute("role", "alert");
      this.root.append(error, this.button("重新读取配置", () => { void this.load(); }));
    } else if (!this.info?.package) this.root.append(node("div", "context-status", "尚未选择测试包"));
    else if (!this.info.apis.length) this.root.append(node("div", "context-status", "此请求尚未配置 Mock 接口"));
    else if (!this.api) {
      this.root.append(node("div", "context-section", "选择要修改的逻辑接口"));
      for (const api of this.info.apis) {
        this.root.append(this.button(`${api.name}${api.id === this.info.matchedApiId ? " · 当前命中" : ""} ›`, () => {
          this.api = api; this.view = "actions"; this.render();
        }, "", true));
      }
    } else this.renderApi(this.api);
    if (this.view !== "scenarios" || this.error || this.loading || this.busy) this.renderCommon(entry);
    this.position();
    (this.root.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? this.root).focus({ preventScroll: true });
  }

  private renderApi(api: ExtensionControlledApi) {
    if (this.view === "scenarios") {
      this.root.append(this.button("‹ 接口操作", () => { this.view = "actions"; this.render(); }));
      this.root.append(node("div", "context-section", api.name));
      if (api.mode === "conditional") this.root.append(node("div", "context-status", "选择场景后切换为固定响应，保留原条件分支"));
      if (!api.scenarios.length) this.root.append(node("div", "context-status", "暂无响应场景"));
      for (const scenario of api.scenarios) {
        const button = this.button(`${scenario.name}${scenario.responseType === "mock" ? "" : " · 混合"}`, () => {
          void this.apply({ action: "scenario", scenarioId: scenario.id });
        }, scenario.status < 200 ? "浏览器不支持该状态码" : "");
        button.setAttribute("role", "menuitemradio");
        button.setAttribute("aria-checked", String(api.enabled && !api.passthrough && api.mode === "fixed" && api.activeScenarioId === scenario.id));
        this.root.append(button);
      }
      return;
    }
    if (this.info!.apis.length > 1) this.root.append(this.button("‹ 选择其他接口", () => { this.api = undefined; this.view = "apis"; this.render(); }));
    this.root.append(node("div", "context-section", api.name));
    if (this.info!.matchedApiId && this.info!.matchedApiId !== api.id)
      this.root.append(node("div", "context-status", "当前请求命中其他接口；匹配优先级不变"));
    const enabled = api.enabled && !api.passthrough;
    const toggle = this.button(enabled ? "停用 Mock" : "启用 Mock", () => {
      void this.apply({ action: enabled ? "pass" : "mock" });
    }, enabled ? "" : api.mockUnavailableReason);
    this.root.append(toggle, this.button("切换响应场景 ›", () => { this.view = "scenarios"; this.render(); }, api.scenarios.length ? "" : "请先保存响应场景", true));
  }

  private renderCommon(entry: TrafficEntry) {
    this.root.append(node("div", "context-divider"));
    this.root.append(this.button("保存此响应为新场景…", () => { this.close(); void this.actions.save(entry); }, captureUnavailableReason(entry)));
    const packageId = this.info?.package?.id, apiId = this.api?.id;
    this.root.append(this.button(apiId ? "打开接口配置" : "打开控制台", () => {
      this.close();
      void this.actions.openConsole(consoleApiUrl(packageId, apiId)).catch(() => this.actions.notice("无法打开控制台，请访问 127.0.0.1:22333"));
    }));
    this.root.append(this.button("复制 URL", () => { this.close(); this.actions.copy(entry.request.url); }));
    this.root.append(this.button("复制 cURL", () => { this.close(); this.actions.copy(this.actions.curl(entry)); }));
    if (entry.response?.body !== undefined) this.root.append(this.button("复制响应", () => { this.close(); this.actions.copy(entry.response!.body!); }));
  }

  private async apply(action: { action: "mock" | "pass" } | { action: "scenario"; scenarioId: string }) {
    if (this.busy || !this.api || !this.info?.package) return;
    const api = this.api;
    const command: ExtensionControlCommand = { packageId: this.info.package.id, apiId: api.id, revision: api.revision, ...action };
    this.busy = true;
    this.render();
    try {
      await applyRequestControl(command);
      if (this.destroyed) return;
      const result = action.action === "pass" ? "Mock 已停用" : action.action === "mock" ? "Mock 已启用" : "响应场景已切换";
      this.actions.notice(`「${api.name}」${result}`);
      this.busy = false;
      this.close();
    } catch (error) {
      if (this.destroyed) return;
      this.busy = false;
      this.error = message(error);
      this.render();
    }
  }

  private button(label: string, run: () => void, disabledReason = "", submenu = false) {
    const button = node("button", "context-item", label);
    button.type = "button";
    button.setAttribute("role", "menuitem");
    if (submenu) button.setAttribute("aria-haspopup", "menu");
    button.disabled = this.busy || Boolean(disabledReason);
    button.title = disabledReason || label;
    button.addEventListener("click", () => { if (!button.disabled) run(); });
    return button;
  }

  private position() {
    const rect = this.root.getBoundingClientRect();
    this.root.style.left = `${Math.max(8, Math.min(this.x, window.innerWidth - rect.width - 8))}px`;
    this.root.style.top = `${Math.max(8, Math.min(this.y, window.innerHeight - rect.height - 8))}px`;
  }

  private keydown(event: KeyboardEvent) {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      this.close(); return;
    }
    const buttons = Array.from(this.root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp") next = index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "ArrowLeft" && this.view === "scenarios") { this.view = "actions"; this.render(); event.preventDefault(); return; }
    else if (event.key === "ArrowRight" && buttons[index]?.getAttribute("aria-haspopup") === "menu") { buttons[index].click(); event.preventDefault(); return; }
    else return;
    event.preventDefault();
    buttons[next].focus();
  }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function message(error: unknown) { return error instanceof Error ? error.message : "接口操作失败，请重新读取配置"; }
