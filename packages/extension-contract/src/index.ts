/**
 * Wire contract shared by the browser extension and the local resolver.
 * This package has no runtime dependency on the Mock Console or browser APIs.
 */
export type ExtensionPassReason = "unmatched" | "disabled" | "invalid-request" | "unsupported-status";

export type ExtensionRuntimeRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** 页面脚本提交的文本请求体，仅用于本机请求日志，不参与匹配。 */
  body?: string;
  /** 超过本地 resolver 容量或读取失败时，不改变 Mock 判定。 */
  bodyUnavailable?: "too-large" | "unavailable";
};

export type ExtensionRuntimeResponse =
  | {
      action: "mock";
      status: number;
      delayMs: number;
      body: string;
      headers: Record<string, string>;
    }
  | {
      action: "pass";
      reason?: ExtensionPassReason;
    };
