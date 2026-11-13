import { BLOCKING_PORT, type BlockingRule, type BlockingRuleInput } from "./blocking-rules.js";

export class RequestBlockingClient {
  private port?: RuntimePort;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private ready = false;
  private pending = new Map<string, { resolve(): void; reject(error: Error): void }>();

  constructor(private readonly state: (rules: BlockingRule[]) => void, private readonly error: (message: string) => void) { this.connect(); }

  private connect() {
    if (this.closed) return;
    try {
      const port = chrome.runtime.connect({ name: BLOCKING_PORT });
      this.port = port;
      port.onMessage.addListener(value => {
        if (this.port !== port || !value || typeof value !== "object") return;
        const message = value as Record<string, unknown>;
        if (message.type === "state" && Array.isArray(message.rules)) {
          this.ready = true;
          this.state(message.rules as BlockingRule[]);
        } else if (message.type === "error" && typeof message.error === "string") {
          this.ready = false;
          this.error(message.error);
        } else if (message.type === "result" && typeof message.requestId === "string") {
          const pending = this.pending.get(message.requestId);
          this.pending.delete(message.requestId);
          if (message.ok === true) pending?.resolve();
          else pending?.reject(new Error(String(message.error ?? "保存屏蔽规则失败")));
        }
      });
      port.onDisconnect.addListener(() => {
        if (this.port !== port) return;
        this.disconnected();
      });
      port.postMessage({ type: "subscribe" });
    } catch { this.disconnected(); }
  }

  private disconnected() {
    this.port = undefined;
    this.ready = false;
    for (const pending of this.pending.values()) pending.reject(new Error("扩展连接已断开，操作结果未确认，请重新读取规则核对"));
    this.pending.clear();
    if (!this.closed) {
      this.error("屏蔽规则连接已断开，正在重新连接…");
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.connect(), 1000);
    }
  }

  save(input: BlockingRuleInput, rule?: BlockingRule) { return this.command({ type: "save", input, id: rule?.id, revision: rule?.revision }); }
  delete(rule: BlockingRule) { return this.command({ type: "delete", id: rule.id, revision: rule.revision }); }

  private command(command: Record<string, unknown>) {
    const port = this.port;
    if (!port || !this.ready) return Promise.reject(new Error("屏蔽规则尚未读取成功，请重试"));
    return new Promise<void>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      this.pending.set(requestId, { resolve, reject });
      try { port.postMessage({ ...command, requestId }); }
      catch { this.disconnected(); }
    });
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.port?.disconnect();
    this.disconnected();
  }
}
