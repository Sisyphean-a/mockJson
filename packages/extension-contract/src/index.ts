/** 扩展与本机 resolver 的共享线协议，不依赖浏览器或 Mock Console 运行时。 */
export type ExtensionPassReason = "unmatched" | "disabled" | "invalid-request" | "unsupported-status";

export type ExtensionRuntimeRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** 页面脚本提交的文本请求体，仅用于本机请求日志，不参与匹配。 */
  body?: string;
  /** 上传体不采集、超出 resolver 容量或读取失败时，不改变 Mock 判定。 */
  bodyUnavailable?: "too-large" | "unavailable" | "upload";
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
