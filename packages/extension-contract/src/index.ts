/** 扩展与本机服务的共享线协议，不依赖浏览器或 Mock Console 运行时。 */
export type ExtensionCaptureInput = {
  request: { url: string; method: string };
  response: { status: number; body: string };
};

export type ExtensionCaptureTicket = { id: string; expiresAt: number };

export type ExtensionPassReason = "unmatched" | "disabled" | "invalid-request" | "unsupported-status";

export type ExtensionRuntimeRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** 页面可读取的文本原文，用于日志及已匹配接口内部的响应条件，不扩大接口匹配范围。 */
  body?: string;
  /** 请求体不可用时，响应分支的请求体条件不命中，请求头条件仍正常判定。 */
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
