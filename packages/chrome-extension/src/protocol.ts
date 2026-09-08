import type {
  ExtensionRuntimeRequest,
  ExtensionRuntimeResponse,
} from "../../mock-console/shared/types.js";

export const CHANNEL = "__mock_console_extension_v1";
export const RESOLVER_PATH = "/__mock_extension/resolve";
export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:22333";
export const RESOLVE_TIMEOUT_MS = 200;

export type ResolveMessage = {
  channel: typeof CHANNEL;
  type: "resolve";
  id: string;
  request: ExtensionRuntimeRequest;
};

export type ResolveResultMessage = {
  channel: typeof CHANNEL;
  type: "resolve-result";
  id: string;
  result: ExtensionRuntimeResponse;
};

export function isResolveResultMessage(value: unknown): value is ResolveResultMessage {
  if (!isRecord(value)) return false;
  return value.channel === CHANNEL && value.type === "resolve-result" && typeof value.id === "string" && isRuntimeResponse(value.result);
}

export function isRuntimeResponse(value: unknown): value is ExtensionRuntimeResponse {
  if (!isRecord(value) || (value.action !== "mock" && value.action !== "pass")) return false;
  if (value.action === "pass") return true;
  const status = value.status;
  const delayMs = value.delayMs;
  return (
    typeof status === "number" && Number.isInteger(status) && status >= 200 && status <= 599 &&
    typeof delayMs === "number" && Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 30000 &&
    typeof value.body === "string" && isRecord(value.headers) &&
    Object.values(value.headers).every((header) => typeof header === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
