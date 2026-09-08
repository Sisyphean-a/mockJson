import type { ExtensionRuntimeRequest, ExtensionRuntimeResponse } from "../../mock-console/shared/types.js";
const CHANNEL = "__mock_console_extension_v1";

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

async function resolve(message: ResolveMessage) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (isRuntimeResponse(result)) return result;
  } catch {
    // The page must keep its original request semantics when Mock Console is unavailable.
  }
  return { action: "pass", reason: "invalid-request" } as const;
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
