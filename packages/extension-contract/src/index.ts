/**
 * Wire contract shared by the browser extension and the local resolver.
 * This package has no runtime dependency on the Mock Console or browser APIs.
 */
export type ExtensionPassReason = "unmatched" | "disabled" | "invalid-request" | "unsupported-status";

export type ExtensionRuntimeRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
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
