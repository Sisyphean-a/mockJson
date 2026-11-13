import type { BlockingRuleInput } from "./blocking-rules.js";

export function openBlockingDialog(options: { pageOrigin?: string; draft?: BlockingRuleInput; showBlocked: boolean; reveal(value: boolean): void }) {
  const dialog = document.createElement("dialog");
  dialog.className = "blocking-dialog";
  dialog.setAttribute("aria-label", "请求屏蔽");
  dialog.innerHTML = `<div class="blocking-heading"><strong>请求屏蔽</strong><button class="button" type="button" aria-label="关闭请求屏蔽">关闭</button></div><iframe title="请求屏蔽规则"></iframe><label class="blocking-reveal"><input type="checkbox" />临时显示被屏蔽的请求（仅本面板）</label>`;
  const iframe = dialog.querySelector("iframe")!;
  const checkbox = dialog.querySelector("input")!;
  checkbox.checked = options.showBlocked;
  checkbox.addEventListener("change", () => options.reveal(checkbox.checked));
  const url = new URL(chrome.runtime.getURL("blocking-manager.html"));
  if (options.pageOrigin) url.searchParams.set("pageOrigin", options.pageOrigin);
  if (options.draft) {
    url.searchParams.set("pageOrigin", options.draft.scopeOrigin);
    url.searchParams.set("targetUrl", options.draft.targetUrl);
    url.searchParams.set("method", options.draft.method);
  }
  iframe.src = url.href;
  const closeFromFrame = (event: MessageEvent) => {
    if (event.source === iframe.contentWindow && event.data?.type === "request-blocking-close") dialog.close();
  };
  dialog.querySelector("button")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { window.removeEventListener("message", closeFromFrame); dialog.remove(); });
  window.addEventListener("message", closeFromFrame);
  document.body.append(dialog);
  dialog.showModal();
}
