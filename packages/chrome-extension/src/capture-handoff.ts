import type { ExtensionCaptureInput, ExtensionCaptureTicket } from "@mock-json/extension-contract";
import { DEFAULT_RUNTIME_URL, type TrafficEntry } from "./protocol.js";

export function captureUnavailableReason(entry: TrafficEntry): string {
  if (entry.endedAt === undefined) return "请求尚未完成";
  const response = entry.response;
  if (!response || entry.error) return "请求失败或没有响应";
  if (response.bodyTruncated || response.bodyUnavailable) return "响应未完整采集，请重新请求后再保存";
  if (response.body === undefined || response.body === "") return "响应没有 JSON 内容";
  if (response.status < 200 || response.status > 599) return "浏览器 Mock 仅支持 200–599 状态码";
  try { JSON.parse(response.body); } catch { return "响应不是合法 JSON，无法保存为 Mock 场景"; }
  return "";
}

export async function handoffCapture(entry: TrafficEntry, send: typeof fetch = fetch): Promise<ExtensionCaptureTicket> {
  const reason = captureUnavailableReason(entry);
  if (reason) throw new Error(reason);
  // Rule: 只交接选中的 URL、Method 和响应，不发送 Cookie、请求头或请求体。
  const input: ExtensionCaptureInput = {
    request: { url: entry.request.url, method: entry.request.method },
    response: { status: entry.response!.status, body: entry.response!.body! },
  };
  let response: Response;
  try {
    response = await send(DEFAULT_RUNTIME_URL + "/__mock_extension/captures", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
  } catch (cause) {
    throw new Error("无法连接 Mock Console，请启动 22333 服务后重试", { cause });
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error || `交接失败（HTTP ${response.status}），请检查服务版本`);
  }
  const ticket = await response.json() as ExtensionCaptureTicket;
  if (typeof ticket.id !== "string" || !/^[0-9a-f-]{36}$/.test(ticket.id) || !Number.isFinite(ticket.expiresAt))
    throw new Error("服务返回了无效的响应草稿");
  return ticket;
}
