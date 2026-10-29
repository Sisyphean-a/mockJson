import type { ScenarioResponseType } from "./response-fields.js";
export type { ScenarioResponseType } from "./response-fields.js";

/** 扩展与本机服务的共享线协议，不依赖浏览器或 Mock Console 运行时。 */
export type ExtensionCaptureInput = {
  request: { url: string; method: string };
  response: { status: number; body: string };
};

export type ExtensionCaptureTicket = { id: string; expiresAt: number };

export type ExtensionPassReason = "unmatched" | "disabled" | "invalid-request" | "unsupported-status" | "api-passthrough";

export type ExtensionRuntimeRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** 页面可读取的文本原文，用于日志及已匹配接口内部的响应条件，不扩大接口匹配范围。 */
  body?: string;
  /** 请求体不可用时，响应分支的请求体条件不命中，请求头条件仍正常判定。 */
  bodyUnavailable?: "too-large" | "unavailable" | "upload";
};

export type ExtensionControlRequest = Pick<ExtensionRuntimeRequest, "url" | "method" | "headers">;

export type ExtensionControlledApi = {
  id: string;
  name: string;
  enabled: boolean;
  passthrough: boolean;
  revision: string;
  mode: "fixed" | "conditional";
  activeScenarioId: string | null;
  mockUnavailableReason: string;
  scenarios: { id: string; name: string; status: number; responseType: ScenarioResponseType }[];
};

export type ExtensionControlInspection = {
  package: { id: string; name: string } | null;
  matchedApiId: string | null;
  apis: ExtensionControlledApi[];
};

export type ExtensionControlCommand = {
  packageId: string;
  apiId: string;
  revision: string;
} & ({ action: "mock" | "pass" } | { action: "scenario"; scenarioId: string });

export type ExtensionRuntimeResponse =
  | {
      action: "mock";
      status: number;
      delayMs: number;
      body: string;
      headers: Record<string, string>;
    }
  | {
      action: "transform";
      responseType: Exclude<ScenarioResponseType, "mock">;
      fieldPaths: string[];
      status: number;
      delayMs: number;
      body: string;
    }
  | {
      action: "pass";
      reason?: ExtensionPassReason;
    };
