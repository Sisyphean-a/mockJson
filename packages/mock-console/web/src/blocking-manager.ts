import { BLOCKING_MANAGER_CHANNEL, isBlockingConsoleUrl, isBlockingManagerUrl } from "@mock-json/extension-contract/blocking-manager";

export function discoverBlockingManager(target: Window, signal: AbortSignal): Promise<string> {
  if (!isBlockingConsoleUrl(target.location.href)) return Promise.reject(new Error("请在本机 22333 控制台或 22334 开发页面管理扩展屏蔽规则"));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const cleanup = () => {
      target.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      clearTimeout(timer);
    };
    const abort = () => { cleanup(); reject(new Error("已关闭请求屏蔽")); };
    const receive = (event: MessageEvent) => {
      if (event.source !== target || event.origin !== target.location.origin ||
          event.data?.channel !== BLOCKING_MANAGER_CHANNEL || event.data.type !== "manager" ||
          event.data.id !== id || !isBlockingManagerUrl(event.data.url)) return;
      cleanup(); resolve(event.data.url);
    };
    const timer = setTimeout(() => {
      cleanup(); reject(new Error("未连接到浏览器扩展。请安装或重新加载扩展，并刷新此控制台页面后重试。"));
    }, 2000);
    target.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    target.postMessage({ channel: BLOCKING_MANAGER_CHANNEL, type: "discover", id }, target.location.origin);
  });
}
