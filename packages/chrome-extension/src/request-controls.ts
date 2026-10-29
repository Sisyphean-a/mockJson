import type { ExtensionControlCommand, ExtensionControlInspection, ExtensionControlledApi } from "@mock-json/extension-contract";
import { DEFAULT_RUNTIME_URL, type TrafficEntry } from "./protocol.js";

export async function inspectRequestControls(entry: TrafficEntry, signal?: AbortSignal, send: typeof fetch = fetch): Promise<ExtensionControlInspection> {
  // Rule: 仅用户打开菜单时发送 URL、方法和匹配所需 Header；不发送请求体或响应体，不触发 resolver 日志。
  const result = await request("inspect", { url: entry.request.url, method: entry.request.method, headers: entry.request.headers }, send, signal);
  if (!record(result) || (result.package !== null && (!record(result.package) || typeof result.package.id !== "string" || typeof result.package.name !== "string")) ||
      !Array.isArray(result.apis) || !result.apis.every(validApi) ||
      (result.matchedApiId !== null && (typeof result.matchedApiId !== "string" || !result.apis.some((a) => a.id === result.matchedApiId))))
    throw new Error("服务返回的接口配置无效，请更新 Mock Console");
  return result as ExtensionControlInspection;
}

export async function applyRequestControl(command: ExtensionControlCommand, send: typeof fetch = fetch): Promise<ExtensionControlledApi> {
  const result = await request("apply", command, send);
  if (!validApi(result)) throw new Error("操作结果无法确认，请重新读取配置");
  return result;
}

async function request(action: "inspect" | "apply", body: unknown, send: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await send(DEFAULT_RUNTIME_URL + "/__mock_extension/controls/" + action, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(action === "apply" ? "操作结果无法确认，请重新读取配置后再操作" : "无法连接 Mock Console，请启动 22333 服务后重试", { cause });
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404) throw new Error("服务不支持接口快捷操作，请更新并重启 Mock Console");
    throw new Error(record(result) && typeof result.error === "string" ? result.error : `接口操作失败（HTTP ${response.status}）`);
  }
  return result;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validApi(value: unknown): value is ExtensionControlledApi {
  return record(value) && typeof value.id === "string" && typeof value.name === "string" &&
    typeof value.enabled === "boolean" && typeof value.passthrough === "boolean" &&
    typeof value.revision === "string" && /^[a-f0-9]{64}$/.test(value.revision) &&
    (value.mode === "fixed" || value.mode === "conditional") &&
    (value.activeScenarioId === null || typeof value.activeScenarioId === "string") &&
    typeof value.mockUnavailableReason === "string" && Array.isArray(value.scenarios) &&
    value.scenarios.every((s) => record(s) && typeof s.id === "string" && typeof s.name === "string" &&
      Number.isInteger(s.status) && Number(s.status) >= 100 && Number(s.status) <= 599 &&
      ["mock", "real-overrides", "mock-with-real"].includes(String(s.responseType)));
}

export function consoleApiUrl(packageId?: string, apiId?: string) {
  if (!packageId || !apiId) return DEFAULT_RUNTIME_URL;
  return DEFAULT_RUNTIME_URL + "/#api=" + encodeURIComponent(apiId) + "&package=" + encodeURIComponent(packageId);
}
