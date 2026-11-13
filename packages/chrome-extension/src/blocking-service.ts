import { BLOCKING_PORT } from "./blocking-rules.js";
import { BlockingRuleStore } from "./blocking-store.js";

type Port = RuntimePort & { sender?: { url?: string } };
type Runtime = { getURL(path: string): string; onConnect: { addListener(listener: (port: Port) => void): void } };

export function registerRequestBlocking(runtime: Runtime, store = new BlockingRuleStore()) {
  const subscribers = new Set<Port>();
  const post = (port: Port, message: unknown) => {
    try { port.postMessage(message); } catch { subscribers.delete(port); }
  };
  const snapshot = async (ports: Iterable<Port>) => {
    try {
      const rules = await store.list();
      for (const port of ports) post(port, { type: "state", rules });
    } catch (error) {
      for (const port of ports) post(port, { type: "error", error: errorText(error) });
    }
  };
  runtime.onConnect.addListener(port => {
    if (port.name !== BLOCKING_PORT) return;
    let page = "";
    try {
      const url = new URL(port.sender?.url ?? "");
      url.search = ""; url.hash = "";
      page = url.href;
    } catch { /* Rule: 无扩展页面来源的端口不授予访问权。 */ }
    const manager = page === runtime.getURL("blocking-manager.html");
    if (!manager && page !== runtime.getURL("panel.html")) { port.disconnect(); return; }
    subscribers.add(port);
    port.onDisconnect.addListener(() => subscribers.delete(port));
    port.onMessage.addListener(message => {
      if (!message || typeof message !== "object") return;
      const command = message as Record<string, unknown>;
      if (command.type === "subscribe") { void snapshot([port]); return; }
      if (typeof command.requestId !== "string") return;
      void (async () => {
        try {
          if (!manager) throw new Error("此页面不能修改屏蔽规则");
          if (command.type === "save") {
            if (command.id !== undefined && (typeof command.id !== "string" || typeof command.revision !== "string")) throw new Error("规则版本无效");
            await store.save(command.input, command.id as string | undefined, command.revision as string | undefined);
          } else if (command.type === "delete" && typeof command.id === "string" && typeof command.revision === "string") {
            await store.delete(command.id, command.revision);
          } else throw new Error("屏蔽操作无效");
          await snapshot(subscribers);
          post(port, { type: "result", requestId: command.requestId, ok: true });
        } catch (error) {
          post(port, { type: "result", requestId: command.requestId, ok: false, error: errorText(error) });
        }
      })();
    });
  });
}

function errorText(error: unknown) { return error instanceof Error ? error.message : "屏蔽规则暂时不可用"; }
