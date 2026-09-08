import type { ExtensionRuntimeRequest, ExtensionRuntimeResponse } from "../../mock-console/shared/types.js";
import {
  DEFAULT_RUNTIME_URL,
  RESOLVE_TIMEOUT_MS,
  RESOLVER_PATH,
  CHANNEL,
  isRuntimeResponse,
} from "./protocol.js";

type ResolveMessage = {
  channel: typeof CHANNEL;
  type: "resolve";
  id: string;
  request: ExtensionRuntimeRequest;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isResolveMessage(message)) return undefined;
  void resolve(message.request)
    .then(sendResponse)
    .catch(() => sendResponse({ action: "pass", reason: "invalid-request" }));
  return true;
});

async function resolve(request: ExtensionRuntimeRequest): Promise<ExtensionRuntimeResponse> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const response = await fetch(`${DEFAULT_RUNTIME_URL}${RESOLVER_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) return { action: "pass", reason: "invalid-request" };
    const result: unknown = await response.json();
    return isRuntimeResponse(result) ? result : { action: "pass", reason: "invalid-request" };
  } catch {
    return { action: "pass", reason: "invalid-request" };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function isResolveMessage(value: unknown): value is ResolveMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return message.channel === CHANNEL && message.type === "resolve" && typeof message.id === "string" && isRuntimeRequest(message.request);
}

function isRuntimeRequest(value: unknown): value is ExtensionRuntimeRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (typeof request.url !== "string" || typeof request.method !== "string" || !isRecord(request.headers)) return false;
  return Object.values(request.headers).every((header) => typeof header === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
