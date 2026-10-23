import type {
  ExtensionPassReason,
  ExtensionRuntimeRequest,
  ExtensionRuntimeResponse,
} from "@mock-json/extension-contract";

export const CHANNEL = "__mock_console_extension_v1";
export const RESOLVER_PATH = "/__mock_extension/resolve";
export const STATUS_PATH = "/__mock_extension/status";
export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:22333";
// Rule: 页面桥接层比 Service Worker 多等待一段时间，避免有效响应只因跨扩展消息边界而丢失。
export const RESOLVE_TIMEOUT_MS = 1000;
export const POPUP_CHANNEL = "__mock_console_popup_v1";
export const TRAFFIC_PANEL_PORT = "__mock_console_traffic_panel_v1";
export const TRAFFIC_START_TYPE = "traffic-start";
export const TRAFFIC_REQUEST_BODY_TYPE = "traffic-request-body";
export const TRAFFIC_FINISH_TYPE = "traffic-finish";

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

export type ResolveCancelMessage = {
  channel: typeof CHANNEL;
  type: "cancel";
  id: string;
};

export type MonitoringQueryMessage = {
  channel: typeof CHANNEL;
  type: "get-monitoring";
};

export type MonitoringRefreshMessage = {
  channel: typeof CHANNEL;
  type: "refresh-monitoring";
};

export type MonitoringStateResponse = {
  enabled: boolean;
  /** 当前 frame 是否只记录请求；与 enabled 独立，白名单外页面也可显式开启。 */
  capture: boolean;
  whitelist: string[];
};

export type PopupState = {
  serverOnline: boolean;
  hasPackage: boolean;
  supportedPage: boolean;
  pageWhitelisted: boolean;
  tabId: number | null;
  host: string | null;
  whitelist: string[];
  globalEnabled: boolean;
  tabEnabled: boolean;
  effectiveEnabled: boolean;
  /** 当前标签页是否被显式勾选“只记录”；白名单页面开启 Mock 时会自动记录。 */
  captureTab: boolean;
};

export type PopupMessage =
  | { channel: typeof POPUP_CHANNEL; type: "get-state" }
  | { channel: typeof POPUP_CHANNEL; type: "set-global"; enabled: boolean }
  | { channel: typeof POPUP_CHANNEL; type: "set-tab"; tabId: number; enabled: boolean }
  | { channel: typeof POPUP_CHANNEL; type: "set-capture-tab"; tabId: number; enabled: boolean }
  | { channel: typeof POPUP_CHANNEL; type: "set-whitelist"; domains: string[] };

export type TrafficBodyInfo = {
  body?: string;
  bodyUnavailable?: "too-large" | "unavailable" | "upload" | "binary";
  bodyTruncated?: boolean;
};

export type TrafficRequestSnapshot = {
  method: string;
  url: string;
  headers: Record<string, string>;
} & TrafficBodyInfo;

export type TrafficResponseSnapshot = {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  mimeType?: string;
  size?: number;
} & TrafficBodyInfo;

export type TrafficDecision = "pending" | "mock" | "pass" | "capture";

export type TrafficEntry = {
  id: string;
  tabId: number;
  frameId: number;
  pageUrl: string;
  source: "fetch" | "xhr";
  decision: TrafficDecision;
  passReason?: ExtensionPassReason;
  startedAt: number;
  endedAt?: number;
  request: TrafficRequestSnapshot;
  response?: TrafficResponseSnapshot;
  error?: { name: string; message: string };
};

export type TrafficStartEntry = Pick<TrafficEntry, "id" | "source" | "decision" | "startedAt" | "request">;

export type TrafficStartMessage = {
  channel: typeof CHANNEL;
  type: typeof TRAFFIC_START_TYPE;
  entry: TrafficStartEntry;
};

export type TrafficRequestBodyMessage = {
  channel: typeof CHANNEL;
  type: typeof TRAFFIC_REQUEST_BODY_TYPE;
  id: string;
} & TrafficBodyInfo;

export type TrafficFinishMessage = {
  channel: typeof CHANNEL;
  type: typeof TRAFFIC_FINISH_TYPE;
  id: string;
  decision: TrafficDecision;
  passReason?: ExtensionPassReason;
  endedAt: number;
  response?: TrafficResponseSnapshot;
  error?: { name: string; message: string };
};

export type TrafficWindowMessage =
  | TrafficStartMessage
  | TrafficRequestBodyMessage
  | TrafficFinishMessage;

export type TrafficPanelCommand =
  | { type: "subscribe"; tabId: number }
  | { type: "ping" }
  | { type: "set-capture"; enabled: boolean }
  | { type: "clear" };

export type TrafficPanelMessage =
  | { type: "snapshot"; entries: TrafficEntry[]; captureTab: boolean }
  | { type: "entry"; entry: TrafficEntry }
  | { type: "state"; captureTab: boolean }
  | { type: "pong" }
  | { type: "cleared" };

export type PopupResponse =
  | { ok: true; state: PopupState }
  | { ok: false; error: string };

export function isResolveResultMessage(value: unknown): value is ResolveResultMessage {
  if (!isRecord(value)) return false;
  return value.channel === CHANNEL && value.type === "resolve-result" && typeof value.id === "string" && isRuntimeResponse(value.result);
}

export function isTrafficStartMessage(value: unknown): value is TrafficStartMessage {
  if (!isRecord(value) || value.channel !== CHANNEL || value.type !== TRAFFIC_START_TYPE) return false;
  const entry = value.entry;
  if (!isRecord(entry)) return false;
  return (
    typeof entry.id === "string" && entry.id.length > 0 && entry.id.length <= 128 &&
    (entry.source === "fetch" || entry.source === "xhr") &&
    (entry.decision === "pending" || entry.decision === "mock" || entry.decision === "pass" || entry.decision === "capture") &&
    typeof entry.startedAt === "number" && Number.isFinite(entry.startedAt) &&
    isTrafficRequest(entry.request)
  );
}

export function isTrafficRequestBodyMessage(value: unknown): value is TrafficRequestBodyMessage {
  return isRecord(value) && value.channel === CHANNEL && value.type === TRAFFIC_REQUEST_BODY_TYPE &&
    typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128 && isTrafficBody(value);
}

export function isTrafficFinishMessage(value: unknown): value is TrafficFinishMessage {
  if (!isRecord(value) || value.channel !== CHANNEL || value.type !== TRAFFIC_FINISH_TYPE) return false;
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 128) return false;
  if (value.decision !== "pending" && value.decision !== "mock" && value.decision !== "pass" && value.decision !== "capture") return false;
  if (typeof value.endedAt !== "number" || !Number.isFinite(value.endedAt)) return false;
  if (value.response !== undefined && !isTrafficResponse(value.response)) return false;
  if (value.error !== undefined && !isTrafficError(value.error)) return false;
  if (value.passReason !== undefined && !isPassReason(value.passReason)) return false;
  return true;
}

export function isTrafficWindowMessage(value: unknown): value is TrafficWindowMessage {
  return isTrafficStartMessage(value) || isTrafficRequestBodyMessage(value) || isTrafficFinishMessage(value);
}

export function isStoredTrafficEntry(value: unknown): value is TrafficEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.tabId === "number" && Number.isInteger(value.tabId) &&
    typeof value.frameId === "number" && Number.isInteger(value.frameId) &&
    typeof value.pageUrl === "string" &&
    (value.source === "fetch" || value.source === "xhr") &&
    (value.decision === "pending" || value.decision === "mock" || value.decision === "pass" || value.decision === "capture") &&
    typeof value.startedAt === "number" && Number.isFinite(value.startedAt) &&
    isTrafficRequest(value.request) &&
    (value.response === undefined || isTrafficResponse(value.response)) &&
    (value.error === undefined || isTrafficError(value.error)) &&
    (value.endedAt === undefined || (typeof value.endedAt === "number" && Number.isFinite(value.endedAt)))
  );
}

function isTrafficRequest(value: unknown): value is TrafficRequestSnapshot {
  return isRecord(value) &&
    typeof value.method === "string" && typeof value.url === "string" && isHeaderRecord(value.headers) &&
    isTrafficBody(value);
}

function isTrafficResponse(value: unknown): value is TrafficResponseSnapshot {
  return isRecord(value) &&
    typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 0 && value.status <= 999 &&
    isHeaderRecord(value.headers) &&
    (value.statusText === undefined || typeof value.statusText === "string") &&
    (value.mimeType === undefined || typeof value.mimeType === "string") &&
    (value.size === undefined || (typeof value.size === "number" && Number.isFinite(value.size))) &&
    isTrafficBody(value);
}

function isTrafficBody(value: Record<string, unknown>): boolean {
  const hasBody = value.body !== undefined;
  const hasUnavailable = value.bodyUnavailable !== undefined;
  if (hasBody === hasUnavailable) return !hasBody && !hasUnavailable;
  if (hasBody) return typeof value.body === "string" && value.body.length <= 200_000;
  return value.bodyUnavailable === "too-large" || value.bodyUnavailable === "unavailable" ||
    value.bodyUnavailable === "upload" || value.bodyUnavailable === "binary";
}

function isHeaderRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((header) => typeof header === "string");
}

function isTrafficError(value: unknown): value is { name: string; message: string } {
  return isRecord(value) && typeof value.name === "string" && typeof value.message === "string";
}

function isPassReason(value: unknown): value is ExtensionPassReason {
  return value === "unmatched" || value === "disabled" || value === "invalid-request" || value === "unsupported-status";
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
