import type { ExtensionRuntimeRequest, ExtensionRuntimeResponse } from "../../mock-console/shared/types.js";
const CHANNEL = "__mock_console_extension_v1";
const MONITORING_STATE_TYPE = "monitoring-state";
const REFRESH_MONITORING_TYPE = "refresh-monitoring";

type ResolveMessage = {
  channel: typeof CHANNEL;
  type: "resolve";
  id: string;
  request: ExtensionRuntimeRequest;
};

type ResolveResultMessage = {
  channel: typeof CHANNEL;
  type: "resolve-result";
  id: string;
  result: ExtensionRuntimeResponse;
};

type MonitoringStateWindowMessage = {
  channel: typeof CHANNEL;
  type: typeof MONITORING_STATE_TYPE;
  enabled: boolean;
  whitelist: string[];
};

type MonitoringRefreshMessage = {
  channel: typeof CHANNEL;
  type: typeof REFRESH_MONITORING_TYPE;
};

type MonitoringStateResponse = {
  enabled: boolean;
  whitelist: string[];
};

void syncMonitoringState();

chrome.runtime.onMessage.addListener((message) => {
  if (!isMonitoringRefreshMessage(message)) return;
  void syncMonitoringState();
});

window.addEventListener("message", (event) => {
  if (event.source !== window || !isResolveMessage(event.data)) return;

  const message = event.data;
  void resolve(message).then((result) => {
    const response: ResolveResultMessage = {
      channel: CHANNEL,
      type: "resolve-result",
      id: message.id,
      result,
    };
    window.postMessage(response, "*");
  });
});

async function syncMonitoringState() {
  let state: MonitoringStateResponse = { enabled: false, whitelist: [] };
  try {
    const result: unknown = await chrome.runtime.sendMessage({ channel: CHANNEL, type: "get-monitoring" });
    if (isMonitoringStateResponse(result)) state = result;
  } catch {
    // A missing or unavailable extension keeps the page on native requests.
  }
  const message: MonitoringStateWindowMessage = {
    channel: CHANNEL,
    type: MONITORING_STATE_TYPE,
    enabled: state.enabled,
    whitelist: state.whitelist,
  };
  window.postMessage(message, "*");
}

async function resolve(message: ResolveMessage) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (isRuntimeResponse(result)) return result;
  } catch {
    // The page must keep its original request semantics when Mock Console is unavailable.
  }
  return { action: "pass", reason: "invalid-request" } as const;
}

function isMonitoringRefreshMessage(value: unknown): value is MonitoringRefreshMessage {
  return isRecord(value) && value.channel === CHANNEL && value.type === REFRESH_MONITORING_TYPE;
}

function isMonitoringStateResponse(value: unknown): value is MonitoringStateResponse {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    Array.isArray(value.whitelist) &&
    value.whitelist.every((domain) => typeof domain === "string")
  );
}

function isResolveMessage(value: unknown): value is ResolveMessage {
  if (!isRecord(value) || value.channel !== CHANNEL || value.type !== "resolve" || typeof value.id !== "string") return false;
  return isRuntimeRequest(value.request);
}

function isRuntimeRequest(value: unknown): value is ExtensionRuntimeRequest {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.method !== "string" || !isRecord(value.headers)) return false;
  return Object.values(value.headers).every((header) => typeof header === "string");
}

function isRuntimeResponse(value: unknown): value is ExtensionRuntimeResponse {
  if (!isRecord(value) || (value.action !== "mock" && value.action !== "pass")) return false;
  if (value.action === "pass") return true;
  const status = value.status;
  const delayMs = value.delayMs;
  return (
    typeof status === "number" && Number.isInteger(status) && status >= 200 && status <= 599 &&
    typeof delayMs === "number" && Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 30000 &&
    typeof value.body === "string" && isRecord(value.headers) && Object.values(value.headers).every((header) => typeof header === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
