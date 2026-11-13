import { BLOCKING_MANAGER_CHANNEL, isBlockingConsoleUrl } from "@mock-json/extension-contract/blocking-manager";

if (isBlockingConsoleUrl(location.href) && window.top === window) {
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || !isBlockingConsoleUrl(location.href)) return;
    const message = event.data;
    if (!message || message.channel !== BLOCKING_MANAGER_CHANNEL || message.type !== "discover" || typeof message.id !== "string") return;
    // Rule: 只交接管理页地址，不代理规则读写，也不接收页面传入的扩展命令。
    window.postMessage({ channel: BLOCKING_MANAGER_CHANNEL, type: "manager", id: message.id,
      url: chrome.runtime.getURL("blocking-manager.html") }, location.origin);
  });
}
